package de.tutao.tutanota

import de.tutao.tutanota.push.SseStorage
import de.tutao.tutanota.alarms.AlarmNotificationsManager
import de.tutao.tutanota.offline.OfflineRepository
import org.jdeferred.impl.DeferredObject
import de.tutao.tutanota.credentials.ICredentialsEncryption
import kotlin.jvm.Volatile
import android.webkit.WebMessagePort
import android.webkit.JavascriptInterface
import android.webkit.WebMessagePort.WebMessageCallback
import android.webkit.WebMessage
import org.json.JSONObject
import org.jdeferred.DoneCallback
import org.jdeferred.FailCallback
import org.json.JSONException
import de.tutao.tutanota.JsRequest
import org.jdeferred.Promise
import org.json.JSONArray
import org.jdeferred.Deferred
import de.tutao.tutanota.Crypto.EncryptedFileInfo
import de.tutao.tutanota.LogReader
import de.tutao.tutanota.credentials.CredentialEncryptionMode
import de.tutao.tutanota.OfflineRepoQuery
import kotlin.Throws
import android.app.NotificationManager
import de.tutao.tutanota.push.LocalNotificationsFacade
import android.content.Intent
import android.content.pm.PackageManager
import android.content.ActivityNotFoundException
import androidx.core.content.FileProvider
import android.content.ClipData
import android.content.Context
import android.net.Uri
import android.util.Log
import de.tutao.tutanota.alarms.AlarmNotification
import de.tutao.tutanota.credentials.CredentialsEncryptionFactory
import de.tutao.tutanota.offline.Entity
import java.io.File
import java.io.IOException
import java.io.PrintWriter
import java.io.StringWriter
import java.lang.Exception
import java.lang.RuntimeException
import java.util.*

/**
 * Created by mpfau on 4/8/17.
 */
class Native(
		private val activity: MainActivity,
		private val sseStorage: SseStorage,
		private val alarmNotificationsManager: AlarmNotificationsManager,
		private val offlineRepo: OfflineRepository
) {
	private val crypto: Crypto = Crypto(activity)
	private val files: FileUtil = FileUtil(activity, LocalNotificationsFacade(activity))
	private val contact: Contact = Contact(activity)
	private val queue: MutableMap<String, DeferredObject<Any, Exception, Void>> = HashMap()

	@JvmField
	val themeManager: ThemeManager = ThemeManager(activity)
	private val credentialsEncryption: ICredentialsEncryption = CredentialsEncryptionFactory.create(activity)

	@Volatile
	var webAppInitialized = DeferredObject<Void?, Throwable, Void>()
		private set

	private lateinit var webMessagePort: WebMessagePort
	private var isMessageChannelInitialized = false

	fun setup() {
		activity.webView.addJavascriptInterface(this, JS_NAME)
	}

	@JavascriptInterface
	fun startWebMessageChannel() {
		if (isMessageChannelInitialized) {
			throw RuntimeException("Native message channel must only be initialized once")
		}
		isMessageChannelInitialized = true

		// WebView.post ensures that webview methods are called on the correct thread
		activity.webView.post { initMessageChannel() }
	}

	fun initMessageChannel() {
		val webView = activity.webView
		val (outgoingPort, incomingPort) = webView.createWebMessageChannel()
		webMessagePort = outgoingPort

		outgoingPort.setWebMessageCallback(object : WebMessageCallback() {
			override fun onMessage(port: WebMessagePort, message: WebMessage) {
				handleMessageFromWeb(message.data)
			}
		})

		// We send the port to the web side, this message gets handled by window.onmessage
		webView.postWebMessage(
				WebMessage("", arrayOf(incomingPort)),
				Uri.EMPTY
		)
	}

	/**
	 * Invokes method with args. The returned response is a JSON of the following format:
	 *
	 * @param msg A request (see WorkerProtocol)
	 */
	fun handleMessageFromWeb(msg: String?) {
		Thread(Runnable {
			try {
				val request = JSONObject(msg)
				if (request["type"] == "response") {
					val id = request.getString("id")
					val promise = queue.remove(id)
					if (promise == null) {
						Log.w(TAG, "No request for id $id")
					} else {
						promise.resolve(request)
					}
				} else {
					invokeMethod(request.getString("requestType"), request.getJSONArray("args"))
							.then { result: Any? -> sendResponse(request, result) }
							.fail { e: Exception -> sendErrorResponse(request, e) }
				}
			} catch (e: JSONException) {
				Log.e("Native", "could not parse msg:", e)
			}
		}).start()
	}

	fun sendRequest(type: JsRequest, args: Array<Any?>): Promise<Any, Exception, *> {
		val request = JSONObject()
		val requestId = createRequestId()
		return try {
			val arguments = JSONArray()
			for (arg in args) {
				arguments.put(arg)
			}
			request.put("id", requestId)
			request.put("type", "request")
			request.put("requestType", type.toString())
			request.put("args", arguments)
			postMessage(request)
			val d = DeferredObject<Any, Exception, Void>()
			queue[requestId] = d
			d.promise()
		} catch (e: JSONException) {
			throw RuntimeException(e)
		}
	}

	private fun sendResponse(request: JSONObject, value: Any?) {
		val response = JSONObject()
		try {
			response.put("id", request.getString("id"))
			response.put("type", "response")
			response.put("value", value)
			postMessage(response)
		} catch (e: JSONException) {
			throw RuntimeException(e)
		}
	}

	private fun sendErrorResponse(request: JSONObject, ex: Exception) {
		val response = JSONObject()
		try {
			response.put("id", request.getString("id"))
			response.put("type", "requestError")
			response.put("error", errorToObject(ex))
			postMessage(response)
		} catch (e: JSONException) {
			throw RuntimeException(e)
		}
	}

	private fun postMessage(json: JSONObject) {
		webMessagePort.postMessage(WebMessage(json.toString()))
	}

	// Public for testing
	fun invokeMethod(method: String, args: JSONArray): Promise<Any?, Exception, Void> {
		val promise: Deferred<Any?, Exception, Void> = DeferredObject()
		try {
			when (method) {
				"init" -> {
					if (!webAppInitialized.isResolved) {
						webAppInitialized.resolve(null)
					}
					promise.resolve(null)
				}
				"reload" -> {
					webAppInitialized = DeferredObject()
					activity.reload(Utils.jsonObjectToMap(args.getJSONObject(0)))
					promise.resolve(null)
				}
				"initPushNotifications" -> return initPushNotifications()
				"generateRsaKey" -> promise.resolve(crypto.generateRsaKey(Utils.base64ToBytes(args.getString(0))))
				"rsaEncrypt" -> promise.resolve(crypto.rsaEncrypt(args.getJSONObject(0), Utils.base64ToBytes(args.getString(1)), Utils.base64ToBytes(args.getString(2))))
				"rsaDecrypt" -> promise.resolve(crypto.rsaDecrypt(args.getJSONObject(0), Utils.base64ToBytes(args.getString(1))))
				"aesEncryptFile" -> {
					val efi = crypto.aesEncryptFile(Utils.base64ToBytes(args.getString(0)), args.getString(1),
							Utils.base64ToBytes(args.getString(2)))
					promise.resolve(efi.toJSON())
				}
				"aesDecryptFile" -> {
					val key = Utils.base64ToBytes(args.getString(0))
					val fileUrl = args.getString(1)
					promise.resolve(crypto.aesDecryptFile(key, fileUrl))
				}
				"open" -> return files.openFile(args.getString(0), args.getString(1))
				"openFileChooser" -> return files.openFileChooser()
				"deleteFile" -> {
					files.delete(args.getString(0))
					promise.resolve(null)
				}
				"getName" -> promise.resolve(files.getName(args.getString(0)))
				"getMimeType" -> promise.resolve(files.getMimeType(Uri.parse(args.getString(0))))
				"getSize" -> promise.resolve(files.getSize(args.getString(0)).toString() + "")
				"upload" -> promise.resolve(files.upload(args.getString(0), args.getString(1), args.getJSONObject(2)))
				"download" -> promise.resolve(files.download(args.getString(0), args.getString(1), args.getJSONObject(2)))
				"clearFileData" -> {
					files.clearFileData()
					promise.resolve(null)
				}
				"findSuggestions" -> return contact.findSuggestions(args.getString(0))
				"openLink" -> promise.resolve(openLink(args.getString(0)))
				"shareText" -> promise.resolve(shareText(args.getString(0), args.getString(1)))
				"getPushIdentifier" -> promise.resolve(sseStorage.pushIdentifier)
				"storePushIdentifierLocally" -> {
					val deviceIdentififer = args.getString(0)
					val userId = args.getString(1)
					val sseOrigin = args.getString(2)
					Log.d(TAG, "storePushIdentifierLocally")
					sseStorage.storePushIdentifier(deviceIdentififer, sseOrigin)
					val pushIdentifierId = args.getString(3)
					val pushIdentifierSessionKeyB64 = args.getString(4)
					sseStorage.storePushIdentifierSessionKey(userId, pushIdentifierId, pushIdentifierSessionKeyB64)
					promise.resolve(true)
				}
				"closePushNotifications" -> {
					val addressesArray = args.getJSONArray(0)
					cancelNotifications(addressesArray)
					promise.resolve(true)
				}
				"readFile" -> promise.resolve(Utils.bytesToBase64(
						Utils.readFile(File(activity.filesDir, args.getString(0)))))
				"writeFile" -> {
					val filename = args.getString(0)
					val contentInBase64 = args.getString(1)
					Utils.writeFile(File(activity.filesDir, filename),
							Utils.base64ToBytes(contentInBase64))
					promise.resolve(true)
				}
				"getSelectedTheme" -> {
					promise.resolve(themeManager.selectedThemeId)
				}
				"setSelectedTheme" -> {
					val themeId = args.getString(0)
					themeManager.setSelectedThemeId(themeId)
					activity.applyTheme()
					promise.resolve(null)
				}
				"getThemes" -> {
					val themesList = themeManager.themes
					promise.resolve(JSONArray(themesList))
				}
				"setThemes" -> {
					val jsonThemes = args.getJSONArray(0)
					themeManager.setThemes(jsonThemes)
					activity.applyTheme() // reapply theme in case the current selected theme definition has changed
					promise.resolve(null)
				}
				"saveBlob" -> return files.saveBlob(args.getString(0), args.getString(1))
				"putFileIntoDownloads" -> {
					val path = args.getString(0)
					return files.putToDownloadFolder(path)
				}
				"getDeviceLog" -> return Utils.resolvedDeferred(LogReader.getLogFile(activity).toString())
				"changeLanguage" -> promise.resolve(null)
				"scheduleAlarms" -> {
					scheduleAlarms(args.getJSONArray(0))
					promise.resolve(null)
				}
				"encryptUsingKeychain" -> {
					val encryptionMode = args.getString(0)
					val dataToEncrypt = args.getString(1)
					val mode = CredentialEncryptionMode.fromName(encryptionMode)
					val encryptedData = credentialsEncryption.encryptUsingKeychain(dataToEncrypt, mode)
					promise.resolve(encryptedData)
				}
				"decryptUsingKeychain" -> {
					val encryptionMode = args.getString(0)
					val dataToDecrypt = args.getString(1)
					val mode = CredentialEncryptionMode.fromName(encryptionMode)
					val decryptedData = credentialsEncryption.decryptUsingKeychain(dataToDecrypt, mode)
					promise.resolve(decryptedData)
				}
				"getSupportedEncryptionModes" -> {
					val modes = credentialsEncryption.supportedEncryptionModes
					val jsonArray = JSONArray()
					for (mode in modes) {
						jsonArray.put(mode.name)
					}
					promise.resolve(jsonArray)
				}
				"offline.load" -> {
					val query = OfflineRepoQuery.fromJson(args.getJSONObject(0))
					val entity = offlineRepo.load(query.typeRef, query.listId, query.elementId)
					promise.resolve(entity?.data)
				}
				"offline.write" -> {
					val query = OfflineRepoQuery.fromJson(args.getJSONObject(0))
					if (query.payload == null) {
						throw Exception("No payload")
					}
					offlineRepo.insert(Entity(query.typeRef, query.listId, query.elementId, query.payload))
					promise.resolve(null)
				}
				"offline.delete" -> {
					val query = OfflineRepoQuery.fromJson(args.getJSONObject(0))
					offlineRepo.delete(query.typeRef, query.listId, query.elementId)
					promise.resolve(null)
				}
				else -> throw Exception("unsupported method: $method")
			}
		} catch (e: Exception) {
			Log.e(TAG, "failed invocation", e)
			promise.reject(e)
		}
		return promise.promise()
	}

	@Throws(JSONException::class)
	private fun cancelNotifications(addressesArray: JSONArray) {
		val notificationManager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
		Objects.requireNonNull(notificationManager)
		val emailAddesses = ArrayList<String>(addressesArray.length())
		for (i in 0 until addressesArray.length()) {
			notificationManager.cancel(Math.abs(addressesArray.getString(i).hashCode()))
			emailAddesses.add(addressesArray.getString(i))
		}
		activity.startService(LocalNotificationsFacade.notificationDismissedIntent(activity,
				emailAddesses, "Native", false))
	}

	private fun openLink(uri: String?): Boolean {
		val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
		val pm = activity.packageManager
		try {
			activity.startActivity(intent)
		} catch (e: ActivityNotFoundException) {
			Log.i(TAG, "Activity for intent $uri not found.", e)
			return false
		}
		return true
	}

	private fun shareText(string: String, title: String?): Boolean {
		val sendIntent = Intent(Intent.ACTION_SEND)
		sendIntent.type = "text/plain"
		sendIntent.putExtra(Intent.EXTRA_TEXT, string)

		// Shows a text title in the app chooser
		if (title != null) {
			sendIntent.putExtra(Intent.EXTRA_TITLE, title)
		}

		// In order to show a logo thumbnail with the app chooser we need to pass a URI of a file in the filesystem
		// we just save one of our resources to the temp directory and then pass that as ClipData
		// because you can't share non 'content' URIs with other apps
		val imageName = "logo-solo-red.png"
		try {
			val logoInputStream = activity.assets.open("tutanota/images/$imageName")
			val logoFile = files.writeFileToUnencryptedDir(imageName, logoInputStream)
			val logoUri = FileProvider.getUriForFile(activity, BuildConfig.FILE_PROVIDER_AUTHORITY, logoFile)
			val thumbnail = ClipData.newUri(
					activity.contentResolver,
					"tutanota_logo",
					logoUri
			)
			sendIntent.clipData = thumbnail
		} catch (e: IOException) {
			Log.e(TAG, """
 	Error attaching thumbnail to share intent:
 	${e.message}
 	""".trimIndent())
		}
		sendIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
		val intent = Intent.createChooser(sendIntent, null)
		activity.startActivity(intent)
		return true
	}

	private fun initPushNotifications(): Promise<Any?, Exception, Void> {
		activity.runOnUiThread {
			activity.askBatteryOptinmizationsIfNeeded()
			activity.setupPushNotifications()
		}
		return Utils.resolvedDeferred(null)
	}

	@Throws(JSONException::class)
	private fun scheduleAlarms(jsonAlarmsArray: JSONArray) {
		val alarms: MutableList<AlarmNotification> = ArrayList()
		for (i in 0 until jsonAlarmsArray.length()) {
			val json = jsonAlarmsArray.getJSONObject(i)
			val alarmNotification = AlarmNotification.fromJson(json, emptyList())
			alarms.add(alarmNotification)
		}
		alarmNotificationsManager.scheduleNewAlarms(alarms)
	}

	companion object {
		private const val JS_NAME = "nativeApp"
		private const val TAG = "Native"
		private var requestId = 0
		private fun createRequestId(): String {
			return "app" + requestId++
		}

		@Throws(JSONException::class)
		private fun errorToObject(e: Exception): JSONObject {
			val error = JSONObject()
			val errorType = e.javaClass.name
			error.put("name", errorType)
			error.put("message", e.message)
			error.put("stack", getStack(e))
			return error
		}

		private fun getStack(e: Exception): String {
			val errors = StringWriter()
			e.printStackTrace(PrintWriter(errors))
			return errors.toString()
		}

		private fun escape(s: String): String {
			return Utils.bytesToBase64(s.toByteArray())
		}
	}
}

internal class OfflineRepoQuery private constructor(
		val typeRef: String,
		val listId: String,
		val elementId: String,
		val payload: String?
) {
	companion object {
		@Throws(JSONException::class)
		fun fromJson(query: JSONObject): OfflineRepoQuery {
			val typeRef = query.getString("typeRef")
			val listId: String
			listId = try {
				query.getString("listId")
			} catch (e: JSONException) {
				Entity.NO_LIST_ID
			}
			val elementId = query.getString("elementId")
			val payload: String?
			payload = try {
				query.getString("payload")
			} catch (e: JSONException) {
				null
			}
			return OfflineRepoQuery(typeRef, listId, elementId, payload)
		}
	}
}