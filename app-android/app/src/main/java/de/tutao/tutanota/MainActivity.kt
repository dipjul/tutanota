package de.tutao.tutanota

import android.annotation.SuppressLint
import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.*
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.MailTo
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.ContextMenu
import android.view.ContextMenu.ContextMenuInfo
import android.view.View
import android.webkit.*
import android.webkit.WebView.HitTestResult
import android.widget.Toast
import androidx.annotation.MainThread
import androidx.annotation.RequiresPermission
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import de.tutao.tutanota.alarms.AlarmNotificationsManager
import de.tutao.tutanota.alarms.SystemAlarmFacade
import de.tutao.tutanota.credentials.CredentialsEncryptionFactory
import de.tutao.tutanota.data.AppDatabase
import de.tutao.tutanota.ipc.*
import de.tutao.tutanota.push.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.UnsupportedEncodingException
import java.net.URLEncoder
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

class MainActivity : FragmentActivity() {
	lateinit var webView: WebView
		private set
	private lateinit var sseStorage: SseStorage
	private lateinit var themeFacade: AndroidThemeFacade
	private lateinit var remoteBridge: RemoteBridge
	private lateinit var mobileFacade: MobileFacade
	private lateinit var commonNativeFacade: CommonNativeFacade
	private lateinit var commonSystemFacade: AndroidCommonSystemFacade

	private val permissionsRequests: MutableMap<Int, Continuation<Unit>> = ConcurrentHashMap()
	private val activityRequests: MutableMap<Int, Continuation<ActivityResult>> = ConcurrentHashMap()

	private var firstLoaded = false

	@SuppressLint("SetJavaScriptEnabled", "StaticFieldLeak")
	override fun onCreate(savedInstanceState: Bundle?) {
		Log.d(TAG, "App started")

		val fileFacade = AndroidFileFacade(this, LocalNotificationsFacade(this), SecureRandom())
		val cryptoFacade = AndroidNativeCryptoFacade(this, fileFacade.tempDir)
		sseStorage = SseStorage(
				AppDatabase.getDatabase(this, false),
				createAndroidKeyStoreFacade(cryptoFacade)
		)
		val alarmNotificationsManager = AlarmNotificationsManager(
				sseStorage,
				cryptoFacade,
				SystemAlarmFacade(this),
				LocalNotificationsFacade(this)
		)
		val nativePushFacade = AndroidNativePushFacade(
				this,
				sseStorage,
				alarmNotificationsManager
		)

		val ipcJson = Json { ignoreUnknownKeys = true }

		themeFacade = AndroidThemeFacade(this, this)
		commonSystemFacade = AndroidCommonSystemFacade(this, fileFacade.tempDir)
		val contact = Contact(this)

		val globalDispatcher = AndroidGlobalDispatcher(
				ipcJson,
				commonSystemFacade,
				fileFacade,
				AndroidMobileSystemFacade(contact, fileFacade, this),
				CredentialsEncryptionFactory.create(this, cryptoFacade),
				cryptoFacade,
				nativePushFacade,
				themeFacade,
		)
		remoteBridge = RemoteBridge(
				ipcJson,
				this,
				globalDispatcher,
				commonSystemFacade,
		)

		themeFacade.applyCurrentTheme()

		super.onCreate(savedInstanceState)

		mobileFacade = MobileFacadeSendDispatcher(ipcJson, remoteBridge)
		commonNativeFacade = CommonNativeFacadeSendDispatcher(ipcJson, remoteBridge)

		setupPushNotifications()

		webView = WebView(this)
		webView.setBackgroundColor(Color.TRANSPARENT)

		setContentView(webView)
		if (BuildConfig.DEBUG) {
			WebView.setWebContentsDebuggingEnabled(true)
		}

		webView.settings.apply {
			javaScriptEnabled = true
			domStorageEnabled = true
			javaScriptCanOpenWindowsAutomatically = false
			allowFileAccess = false
			allowContentAccess = false
			cacheMode = WebSettings.LOAD_NO_CACHE
			// needed for external content in mail
			mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
		}

		webView.clearCache(true)

		// Reject cookies by external content
		CookieManager.getInstance().setAcceptCookie(false)
		CookieManager.getInstance().removeAllCookies(null)

		if (!firstLoaded) {
			handleIntent(intent)
		}
		firstLoaded = true
		webView.post { // use webView.post to switch to main thread again to be able to observe sseStorage
			sseStorage.observeUsers().observe(this@MainActivity) { userInfos ->
				if (userInfos!!.isEmpty()) {
					Log.d(TAG, "invalidateAlarms")
					lifecycleScope.launchWhenCreated {
						commonNativeFacade.invalidateAlarms()
					}
				}
			}
		}

		webView.webViewClient = object : WebViewClient() {
			@Deprecated("shouldOverrideUrlLoading is deprecated")
			override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
				Log.d(TAG, "see if should override $url")
				if (url.startsWith(BASE_WEBVIEW_URL)) {
					return false
				}
				val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
				try {
					startActivity(intent)
				} catch (e: ActivityNotFoundException) {
					Toast.makeText(this@MainActivity, "Could not open link: $url", Toast.LENGTH_SHORT)
							.show()
				}
				return true
			}

			override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
				val url = request.url
				return if (request.method == "OPTIONS") {
					Log.v(TAG, "replacing OPTIONS response to ${url}")
					WebResourceResponse(
							"text/html",
							"UTF-8",
							200,
							"OK",
							mutableMapOf(
									"Access-Control-Allow-Origin" to "*",
									"Access-Control-Allow-Methods" to "POST, GET, PUT, DELETE",
									"Access-Control-Allow-Headers" to "*"
							),
							null
					)
				} else if (request.method == "GET" && url.toString().startsWith(BASE_WEBVIEW_URL)) {
					Log.v(TAG, "replacing asset GET response to ${url.path}")
					val assetPath = File(BuildConfig.RES_ADDRESS + url.path!!).canonicalPath.run {
						slice(1..lastIndex)
					}
					try {
						if (!assetPath.startsWith(BuildConfig.RES_ADDRESS)) throw IOException("can't find this")
						val ext = MimeTypeMap.getFileExtensionFromUrl(url.toString())
						val mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
						WebResourceResponse(
								mimeType,
								null,
								200,
								"OK",
								null,
								assets.open(assetPath)
						)
					} catch (e: IOException) {
						Log.w(TAG, "Resource not found ${url.path}")
						WebResourceResponse(
								null,
								null,
								404,
								"Not Found",
								null,
								null
						)
					}
				} else {
					Log.v(TAG, "forwarding ${request.method} request to $url")
					null
				}
			}

			override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
				Log.e(TAG, "Error loading WebView $error with ${error?.errorCode} @ ${request?.url?.path}")
			}
		}

		// Handle long click on links in the WebView
		registerForContextMenu(webView)

		val queryParameters = mutableMapOf<String, String>()
		// If opened from notifications, tell Web app to not login automatically, we will pass
		// mailbox later when loaded (in handleIntent())
		if (intent != null && (OPEN_USER_MAILBOX_ACTION == intent.action || OPEN_CALENDAR_ACTION == intent.action)) {
			queryParameters["noAutoLogin"] = "true"
		}
		startWebApp(queryParameters)
	}

	override fun onStart() {
		super.onStart()
		Log.d(TAG, "onStart")
		lifecycleScope.launchWhenCreated {
			mobileFacade.visibilityChange(true)
		}
	}

	override fun onStop() {
		Log.d(TAG, "onStop")
		lifecycleScope.launch { mobileFacade.visibilityChange(false) }
		super.onStop()
	}

	@MainThread
	private fun startWebApp(parameters: MutableMap<String, String>) {
		webView.loadUrl(getInitialUrl(parameters, themeFacade.currentThemeWithFallback))
		remoteBridge.setup()
	}

	override fun onNewIntent(intent: Intent) {
		super.onNewIntent(intent)
		handleIntent(intent)
	}

	private fun handleIntent(intent: Intent) = lifecycleScope.launchWhenCreated {

		// When we redirect to the app from outside, for example after doing payment verification,
		// we don't want to do any kind of intent handling
		val data = intent.data
		if (data != null && data.toString().startsWith("tutanota://")) {
			return@launchWhenCreated
		}

		if (intent.action != null) {
			when (intent.action) {
				Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE, Intent.ACTION_SENDTO, Intent.ACTION_VIEW -> share(intent)
				OPEN_USER_MAILBOX_ACTION -> openMailbox(intent)
				OPEN_CALENDAR_ACTION -> openCalendar(intent)
			}
		}
	}

	override fun onSaveInstanceState(outState: Bundle) {
		super.onSaveInstanceState(outState)
		webView.saveState(outState)
	}

	suspend fun askBatteryOptimizationsIfNeeded() {
		val powerManager = getSystemService(POWER_SERVICE) as PowerManager

		@Suppress("DEPRECATION")
		val preferences = android.preference.PreferenceManager.getDefaultSharedPreferences(this)

		if (
				!preferences.getBoolean(ASKED_BATTERY_OPTIMIZATIONS_PREF, false)
				&& !powerManager.isIgnoringBatteryOptimizations(packageName)
		) {

			commonNativeFacade.showAlertDialog("allowPushNotification_msg")

			withContext(Dispatchers.Main) {
				saveAskedBatteryOptimizations(preferences)
				@SuppressLint("BatteryLife")
				val intent = Intent(
						Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
						Uri.parse("package:$packageName")
				)
				startActivity(intent)
			}
		}
	}

	private fun saveAskedBatteryOptimizations(preferences: SharedPreferences) {
		preferences.edit().putBoolean(ASKED_BATTERY_OPTIMIZATIONS_PREF, true).apply()
	}

	private fun getInitialUrl(parameters: MutableMap<String, String>, theme: Theme?): String {
		if (theme != null) {
			parameters["theme"] = JSONObject.wrap(theme)!!.toString()
		}
		parameters["platformId"] = "android"
		val queryBuilder = StringBuilder()
		for ((key, value) in parameters) {
			try {
				val escapedValue = URLEncoder.encode(value, "UTF-8")
				if (queryBuilder.isEmpty()) {
					queryBuilder.append("?")
				} else {
					queryBuilder.append("&")
				}
				queryBuilder.append(key)
				queryBuilder.append('=')
				queryBuilder.append(escapedValue)
			} catch (e: UnsupportedEncodingException) {
				throw RuntimeException(e)
			}
		}
		// additional path information like app.html/login are not handled properly by the WebView
		// when loaded from local file system. so we are just adding parameters to the Url e.g. ../app.html?noAutoLogin=true.
		return BASE_WEBVIEW_URL + "index-app.html" + queryBuilder.toString()
	}

	private val baseAssetPath: String
		get() = BuildConfig.RES_ADDRESS


	private fun hasPermission(permission: String): Boolean {
		return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
	}

	suspend fun getPermission(permission: String) = suspendCoroutine { continuation ->
		if (hasPermission(permission)) {
			continuation.resume(Unit)
		} else {
			val requestCode = getNextRequestCode()
			permissionsRequests[requestCode] = continuation
			requestPermissions(arrayOf(permission), requestCode)
		}
	}

	override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
		super.onRequestPermissionsResult(requestCode, permissions, grantResults)
		val continuation = permissionsRequests.remove(requestCode)
		if (continuation == null) {
			Log.w(TAG, "No deferred for the permission request$requestCode")
			return
		}
		if (grantResults.size == 1 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
			continuation.resume(Unit)
		} else {
			continuation.resumeWithException(SecurityException("Permission missing: " + permissions.contentToString()))
		}
	}

	suspend fun startActivityForResult(@RequiresPermission intent: Intent?): ActivityResult = suspendCoroutine { continuation ->
		val requestCode = getNextRequestCode()
		activityRequests[requestCode] = continuation
		// we need requestCode to identify the request which is not possible with new API
		@Suppress("DEPRECATION")
		super.startActivityForResult(intent, requestCode)
	}

	@Deprecated("Deprecated in Java")
	override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
		@Suppress("DEPRECATION")
		super.onActivityResult(requestCode, resultCode, data)
		val continuation = activityRequests.remove(requestCode)
		if (continuation != null) {
			continuation.resume(ActivityResult(resultCode, data))
		} else {
			Log.w(TAG, "No deferred for activity request$requestCode")
		}
	}

	fun setupPushNotifications() {
		startService(PushNotificationService.startIntent(this, "MainActivity#setupPushNotifications"))
		val jobScheduler = getSystemService(JOB_SCHEDULER_SERVICE) as JobScheduler
		jobScheduler.schedule(
				JobInfo.Builder(1, ComponentName(this, PushNotificationService::class.java))
						.setPeriodic(TimeUnit.MINUTES.toMillis(15))
						.setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
						.setPersisted(true).build())
	}

	/**
	 * The sharing activity. Either invoked from MainActivity (if the app was not active when the
	 * share occurred) or from onCreate.
	 */
	private suspend fun share(intent: Intent) {
		val action = intent.action
		val clipData = intent.clipData
		val files: List<String>
		var text: String? = null
		val addresses: List<String> = intent.getStringArrayExtra(Intent.EXTRA_EMAIL)?.toList() ?: listOf()
		val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
		if (Intent.ACTION_SEND == action) {
			// Try to read text from the clipboard before fall back on intent.getStringExtra
			if (clipData != null && clipData.itemCount > 0) {
				if (clipData.description.getMimeType(0).startsWith("text")) {
					text = clipData.getItemAt(0).htmlText
				}
				if (text == null && clipData.getItemAt(0).text != null) {
					text = clipData.getItemAt(0).text.toString()
				}
			}
			if (text == null) {
				text = intent.getStringExtra(Intent.EXTRA_TEXT)
			}
			files = getFilesFromIntent(intent)
		} else if (Intent.ACTION_SEND_MULTIPLE == action) {
			files = getFilesFromIntent(intent)
		} else {
			files = listOf()
		}
		val mailToUrlString: String = if (intent.data != null && MailTo.isMailTo(intent.dataString)) {
			intent.dataString ?: ""
		} else {
			""
		}

		commonNativeFacade.createMailEditor(
				files,
				text ?: "",
				addresses,
				subject ?: "",
				mailToUrlString
		)
	}

	private fun getFilesFromIntent(intent: Intent): List<String> {
		val clipData = intent.clipData
		val filesArray: MutableList<String> = mutableListOf()
		if (clipData != null) {
			for (i in 0 until clipData.itemCount) {
				val item = clipData.getItemAt(i)
				val uri = item.uri
				if (uri != null) {
					filesArray.add(uri.toString())
				}
			}
		} else {
			// Intent documentation claims that data is copied to ClipData if it's not there
			// but we want to be sure
			if (Intent.ACTION_SEND_MULTIPLE == intent.action) {
				@Suppress("UNCHECKED_CAST")
				val uris = intent.extras!!.getParcelableArrayList<Uri>(Intent.EXTRA_STREAM)
				if (uris != null) {
					for (uri in uris) {
						filesArray.add(uri.toString())
					}
				}
			} else if (intent.hasExtra(Intent.EXTRA_STREAM)) {
				val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
				filesArray.add(uri.toString())
			} else if (intent.data != null) {
				val uri = intent.data
				filesArray.add(uri.toString())
			} else {
				Log.w(TAG, "Did not find files in the intent")
			}
		}
		return filesArray
	}

	private suspend fun openMailbox(intent: Intent) {
		val userId = intent.getStringExtra(OPEN_USER_MAILBOX_USERID_KEY)
		val address = intent.getStringExtra(OPEN_USER_MAILBOX_MAIL_ADDRESS_KEY)
		val isSummary = intent.getBooleanExtra(IS_SUMMARY_EXTRA, false)
		if (userId == null || address == null) {
			return
		}
		val addresses = ArrayList<String>(1)
		addresses.add(address)
		startService(notificationDismissedIntent(this, addresses,
				"MainActivity#openMailbox", isSummary))

		commonNativeFacade.openMailBox(userId, address, null)
	}

	private suspend fun openCalendar(intent: Intent) {
		val userId = intent.getStringExtra(OPEN_USER_MAILBOX_USERID_KEY) ?: return
		commonNativeFacade.openCalendar(userId)
	}

	override fun onBackPressed() {
		if (commonSystemFacade.initialized) {
			lifecycleScope.launchWhenCreated {
				val result = mobileFacade.handleBackPress()
				try {
					if (!result) {
						goBack()
					}
				} catch (e: JSONException) {
					Log.e(TAG, "error parsing response", e)
				}
			}
		} else {
			goBack()
		}
	}

	private fun goBack() {
		moveTaskToBack(false)
	}

	fun reload(parameters: Map<String, String>) {
		runOnUiThread { startWebApp(parameters.toMutableMap()) }
	}

	override fun onCreateContextMenu(menu: ContextMenu, v: View, menuInfo: ContextMenuInfo?) {
		super.onCreateContextMenu(menu, v, menuInfo)
		val hitTestResult = webView.hitTestResult
		if (hitTestResult.type == HitTestResult.SRC_ANCHOR_TYPE) {
			val link = hitTestResult.extra ?: return
			if (link.startsWith(baseAssetPath)) {
				return
			}
			menu.setHeaderTitle(link)
			menu.add(0, 0, 0, "Copy link").setOnMenuItemClickListener {
				(getSystemService(CLIPBOARD_SERVICE) as ClipboardManager)
						.setPrimaryClip(ClipData.newPlainText(link, link))
				true
			}
			menu.add(0, 2, 0, "Share").setOnMenuItemClickListener {
				val intent = Intent(Intent.ACTION_SEND)
				intent.putExtra(Intent.EXTRA_TEXT, link)
				intent.setTypeAndNormalize("text/plain")
				this.startActivity(Intent.createChooser(intent, "Share link"))
				true
			}
		}
	}

	companion object {
		// don't remove the trailing slash because otherwise longer domains might match our asset check
		const val BASE_WEBVIEW_URL = "https://assets.tutanota.com/"
		const val OPEN_USER_MAILBOX_ACTION = "de.tutao.tutanota.OPEN_USER_MAILBOX_ACTION"
		const val OPEN_CALENDAR_ACTION = "de.tutao.tutanota.OPEN_CALENDAR_ACTION"
		const val OPEN_USER_MAILBOX_MAIL_ADDRESS_KEY = "mailAddress"
		const val OPEN_USER_MAILBOX_USERID_KEY = "userId"
		const val IS_SUMMARY_EXTRA = "isSummary"
		private const val ASKED_BATTERY_OPTIMIZATIONS_PREF = "askedBatteryOptimizations"
		private const val TAG = "MainActivity"
		private var requestId = 0

		@Synchronized
		private fun getNextRequestCode(): Int {
			requestId++
			if (requestId < 0) {
				requestId = 0
			}
			return requestId
		}
	}
}