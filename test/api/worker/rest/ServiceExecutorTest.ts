import o from "ospec"
import {ServiceExecutor} from "../../../../src/api/worker/rest/ServiceExecutor.js"
import {RestClient, RestClientOptions} from "../../../../src/api/worker/rest/RestClient"
import {InstanceMapper} from "../../../../src/api/worker/crypto/InstanceMapper"
import {CryptoFacade} from "../../../../src/api/worker/crypto/CryptoFacade"
import {matchers, object, when} from "testdouble"
import {DeleteService, GetService, PostService, PutService} from "../../../../src/api/common/ServiceRequest"
import {createSaltData, SaltDataTypeRef} from "../../../../src/api/entities/sys/TypeRefs.js"
import {HttpMethod, MediaType, resolveTypeReference} from "../../../../src/api/common/EntityFunctions"
import {deepEqual} from "@tutao/tutanota-utils"
import {assertThrows, verify} from "@tutao/tutanota-test-utils"
import {createGiftCardCreateData, GiftCardCreateDataTypeRef} from "../../../../src/api/entities/sys/TypeRefs.js"
import {ProgrammingError} from "../../../../src/api/common/error/ProgrammingError"
import {AuthHeadersProvider} from "../../../../src/api/worker/facades/UserFacade"

const {anything} = matchers

o.spec("ServiceExecutor", function () {
	const service = {
		app: "testapp",
		name: "testservice",
	}
	let restClient: RestClient
	let authHeaders: Record<string, string>
	let instanceMapper: InstanceMapper
	let cryptoFacade: CryptoFacade
	let executor: ServiceExecutor

	o.beforeEach(function () {
		restClient = object()
		authHeaders = {}
		const authHeadersProvider: AuthHeadersProvider = {
			createAuthHeaders(): Dict {
				return authHeaders
			}
		}
		instanceMapper = object()
		cryptoFacade = object()
		executor = new ServiceExecutor(
			restClient,
			authHeadersProvider,
			instanceMapper,
			() => cryptoFacade,
		)
	})

	function respondWith(response) {
		when(restClient.request(anything(), anything()), {ignoreExtraArgs: true})
			.thenResolve(response)
	}

	o.spec("GET", function () {
		o("encrypts data", async function () {
			const getService: GetService = {
				...service,
				get: {
					data: SaltDataTypeRef,
					return: null,
				}
			}
			const data = createSaltData({mailAddress: "test"})
			const literal = {literal: true}
			const saltTypeModel = await resolveTypeReference(SaltDataTypeRef)
			when(instanceMapper.encryptAndMapToLiteral(saltTypeModel, data, null))
				.thenResolve(literal)

			respondWith(undefined)

			const response = await executor.get(getService, data)

			o(response).equals(undefined)
			verify(
				restClient.request(
					"/rest/testapp/testservice",
					HttpMethod.GET,
					matchers.argThat((params: RestClientOptions) => params.body === `{"literal":true}`),
				),
			)
		})

		o("decrypts response data", async function () {
			const getService: GetService = {
				...service,
				get: {
					data: null,
					return: SaltDataTypeRef,
				},
			}
			const returnData = createSaltData({mailAddress: "test"})
			const literal = {literal: true}
			const saltTypeModel = await resolveTypeReference(SaltDataTypeRef)
			when(instanceMapper.decryptAndMapToInstance(saltTypeModel, literal, null))
				.thenResolve(returnData)

			respondWith(`{"literal":true}`)

			const response = await executor.get(getService, null)

			o(response).equals(returnData)
			verify(
				restClient.request("/rest/testapp/testservice", HttpMethod.GET, matchers.argThat((p) => p.responseType === MediaType.Json))
			)
		})
	})

	o.spec("POST", function () {
		o("encrypts data", async function () {
			const postService: PostService = {
				...service,
				post: {
					data: SaltDataTypeRef,
					return: null,
				}
			}
			const data = createSaltData({mailAddress: "test"})
			const literal = {literal: true}
			const saltTypeModel = await resolveTypeReference(SaltDataTypeRef)
			when(instanceMapper.encryptAndMapToLiteral(saltTypeModel, data, null))
				.thenResolve(literal)

			respondWith(undefined)

			const response = await executor.post(postService, data)

			o(response).equals(undefined)
			verify(
				restClient.request(
					"/rest/testapp/testservice",
					HttpMethod.POST,
					matchers.argThat((params: RestClientOptions) => params.body === `{"literal":true}`),
				),
			)
		})

		o("decrypts response data", async function () {
			const postService: PostService = {
				...service,
				post: {
					data: null,
					return: SaltDataTypeRef,
				},
			}
			const returnData = createSaltData({mailAddress: "test"})
			const literal = {literal: true}
			const saltTypeModel = await resolveTypeReference(SaltDataTypeRef)
			when(instanceMapper.decryptAndMapToInstance(saltTypeModel, literal, null))
				.thenResolve(returnData)

			respondWith(`{"literal":true}`)

			const response = await executor.post(postService, null)

			o(response).equals(returnData)
			verify(
				restClient.request("/rest/testapp/testservice", HttpMethod.POST, matchers.argThat((p) => p.responseType === MediaType.Json))
			)
		})
	})

	o.spec("PUT", function () {
		o("encrypts data", async function () {
			const putService: PutService = {
				...service,
				put: {
					data: SaltDataTypeRef,
					return: null,
				}
			}
			const data = createSaltData({mailAddress: "test"})
			const literal = {literal: true}
			const saltTypeModel = await resolveTypeReference(SaltDataTypeRef)
			when(instanceMapper.encryptAndMapToLiteral(saltTypeModel, data, null))
				.thenResolve(literal)

			respondWith(undefined)

			const response = await executor.put(putService, data)

			o(response).equals(undefined)
			verify(
				restClient.request(
					"/rest/testapp/testservice",
					HttpMethod.PUT,
					matchers.argThat((params: RestClientOptions) => params.body === `{"literal":true}`),
				),
			)
		})

		o("decrypts response data", async function () {
			const putService: PutService = {
				...service,
				put: {
					data: null,
					return: SaltDataTypeRef,
				},
			}
			const returnData = createSaltData({mailAddress: "test"})
			const literal = {literal: true}
			const saltTypeModel = await resolveTypeReference(SaltDataTypeRef)
			when(instanceMapper.decryptAndMapToInstance(saltTypeModel, literal, null))
				.thenResolve(returnData)

			respondWith(`{"literal":true}`)

			const response = await executor.put(putService, null)

			o(response).equals(returnData)
			verify(
				restClient.request("/rest/testapp/testservice", HttpMethod.PUT, matchers.argThat((p) => p.responseType === MediaType.Json))
			)
		})
	})

	o.spec("DELETE", function () {
		o("encrypts data", async function () {
			const deleteService: DeleteService = {
				...service,
				delete: {
					data: SaltDataTypeRef,
					return: null,
				}
			}
			const data = createSaltData({mailAddress: "test"})
			const literal = {literal: true}
			const saltTypeModel = await resolveTypeReference(SaltDataTypeRef)
			when(instanceMapper.encryptAndMapToLiteral(saltTypeModel, data, null))
				.thenResolve(literal)

			respondWith(undefined)

			const response = await executor.delete(deleteService, data)

			o(response).equals(undefined)
			verify(
				restClient.request(
					"/rest/testapp/testservice",
					HttpMethod.DELETE,
					matchers.argThat((params: RestClientOptions) => params.body === `{"literal":true}`),
				),
			)
		})

		o("decrypts response data", async function () {
			const deleteService: DeleteService = {
				...service,
				delete: {
					data: null,
					return: SaltDataTypeRef,
				},
			}
			const returnData = createSaltData({mailAddress: "test"})
			const literal = {literal: true}
			const saltTypeModel = await resolveTypeReference(SaltDataTypeRef)
			when(instanceMapper.decryptAndMapToInstance(saltTypeModel, literal, null))
				.thenResolve(returnData)

			respondWith(`{"literal":true}`)

			const response = await executor.delete(deleteService, null)

			o(response).equals(returnData)
			verify(
				restClient.request("/rest/testapp/testservice", HttpMethod.DELETE, matchers.argThat((p) => p.responseType === MediaType.Json))
			)
		})
	})


	o.spec("params", async function () {
		o("adds query params", async function () {
			const getService: GetService = {
				...service,
				get: {
					data: SaltDataTypeRef,
					return: null,
				}
			}
			const data = createSaltData({mailAddress: "test"})
			const query = Object.freeze({myQueryParam: "2"})
			when(instanceMapper.encryptAndMapToLiteral(anything(), anything(), anything()))
				.thenResolve({})
			respondWith(undefined)

			const response = await executor.get(getService, data, {queryParams: query})

			o(response).equals(undefined)
			verify(
				restClient.request(
					"/rest/testapp/testservice",
					HttpMethod.GET,
					matchers.argThat((opts: RestClientOptions) => deepEqual(opts.queryParams, query))
				)
			)
		})

		o("adds extra headers", async function () {
			const getService: GetService = {
				...service,
				get: {
					data: SaltDataTypeRef,
					return: null,
				}
			}
			const data = createSaltData({mailAddress: "test"})
			const headers = Object.freeze({myHeader: "2"})
			const saltTypeModel = await resolveTypeReference(SaltDataTypeRef)
			when(instanceMapper.encryptAndMapToLiteral(anything(), anything(), anything()))
				.thenResolve({})
			respondWith(undefined)

			const response = await executor.get(getService, data, {extraHeaders: headers})

			o(response).equals(undefined)

			verify(
				restClient.request(
					"/rest/testapp/testservice",
					HttpMethod.GET,
					matchers.argThat((opts: RestClientOptions) => deepEqual(opts.headers, {v: saltTypeModel.version, myHeader: "2"}))
				)
			)
		})

		o("adds auth headers", async function () {
			const getService: GetService = {
				...service,
				get: {
					data: SaltDataTypeRef,
					return: null,
				}
			}
			const data = createSaltData({mailAddress: "test"})
			const accessToken = "myAccessToken"
			authHeaders = {accessToken}
			const saltTypeModel = await resolveTypeReference(SaltDataTypeRef)
			when(instanceMapper.encryptAndMapToLiteral(anything(), anything(), anything()))
				.thenResolve({})
			respondWith(undefined)

			const response = await executor.get(getService, data)

			o(response).equals(undefined)
			verify(
				restClient.request(
					"/rest/testapp/testservice",
					HttpMethod.GET,
					matchers.argThat((opts: RestClientOptions) => deepEqual(opts.headers, {v: saltTypeModel.version, accessToken}))
				)
			)
		})
	})

	o.spec("keys", function () {
		o("uses resolved key to decrypt response", async function () {
			const getService: GetService = {
				...service,
				get: {
					data: null,
					return: SaltDataTypeRef,
				},
			}
			const returnData = createSaltData({mailAddress: "test"})
			const literal = {literal: true}
			const saltTypeModel = await resolveTypeReference(SaltDataTypeRef)
			const sessionKey = [1, 2, 3]
			when(cryptoFacade.resolveServiceSessionKey(saltTypeModel, literal)).thenResolve(sessionKey)
			when(instanceMapper.decryptAndMapToInstance(saltTypeModel, literal, sessionKey))
				.thenResolve(returnData)

			respondWith(`{"literal":true}`)

			const response = await executor.get(getService, null)

			o(response).equals(returnData)
			verify(
				restClient.request("/rest/testapp/testservice", HttpMethod.GET, matchers.argThat((p) => p.responseType === MediaType.Json))
			)
		})

		o("uses passed key to decrypt response", async function () {
			const getService: GetService = {
				...service,
				get: {
					data: null,
					return: SaltDataTypeRef,
				},
			}
			const returnData = createSaltData({mailAddress: "test"})
			const literal = {literal: true}
			const saltTypeModel = await resolveTypeReference(SaltDataTypeRef)
			const sessionKey = [1, 2, 3]
			when(cryptoFacade.resolveServiceSessionKey(saltTypeModel, literal)).thenResolve(null)
			when(instanceMapper.decryptAndMapToInstance(saltTypeModel, literal, sessionKey))
				.thenResolve(returnData)

			respondWith(`{"literal":true}`)

			const response = await executor.get(getService, null, {sessionKey})

			o(response).equals(returnData)
			verify(
				restClient.request("/rest/testapp/testservice", HttpMethod.GET, matchers.argThat((p) => p.responseType === MediaType.Json))
			)
		})

		o("uses passed key to encrypt request data", async function () {
			const getService: GetService = {
				...service,
				get: {
					data: GiftCardCreateDataTypeRef,
					return: null,
				},
			}
			const giftCardCreateData = createGiftCardCreateData({message: "test"})
			const dataTypeModel = await resolveTypeReference(GiftCardCreateDataTypeRef)
			const sessionKey = [1, 2, 3]
			const encrypted = {encrypted: true}
			when(instanceMapper.encryptAndMapToLiteral(dataTypeModel, giftCardCreateData, sessionKey))
				.thenResolve(encrypted)

			respondWith(undefined)

			const response = await executor.get(getService, giftCardCreateData, {sessionKey})

			o(response).equals(undefined)
			verify(
				restClient.request("/rest/testapp/testservice", HttpMethod.GET, matchers.argThat((p) => p.body === `{"encrypted":true}`))
			)
		})

		o("when data is encrypted and the key is not passed it throws", async function () {
			const getService: GetService = {
				...service,
				get: {
					data: GiftCardCreateDataTypeRef,
					return: null,
				},
			}
			const giftCardCreateData = createGiftCardCreateData({message: "test"})

			assertThrows(ProgrammingError, () => executor.get(getService, giftCardCreateData))

			verify(
				restClient.request(anything(), anything()),
				{ignoreExtraArgs: true, times: 0},
			)
		})
	})
})