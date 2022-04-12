import type {CryptoFacade} from "../crypto/CryptoFacade"
import {encryptBytes, encryptString} from "../crypto/CryptoFacade"
import type {GroupInfo, ReceivedGroupInvitation} from "../../entities/sys/TypeRefs.js"
import type {ShareCapability} from "../../common/TutanotaConstants"
import type {GroupInvitationPostReturn} from "../../entities/tutanota/TypeRefs.js"
import {
	createGroupInvitationDeleteData,
	createGroupInvitationPostData,
	createGroupInvitationPutData,
	createSharedGroupData
} from "../../entities/tutanota/TypeRefs.js"
import {neverNull} from "@tutao/tutanota-utils"
import {RecipientsNotFoundError} from "../../common/error/RecipientsNotFoundError"
import {LoginFacadeImpl} from "./LoginFacade"
import {assertWorkerOrNode} from "../../common/Env"
import {aes128RandomKey, bitArrayToUint8Array, encryptKey, uint8ArrayToBitArray} from "@tutao/tutanota-crypto"
import {IServiceExecutor} from "../../common/ServiceRequest"
import {GroupInvitationService} from "../../entities/tutanota/Services.js"
import {UserFacade} from "./UserFacade"

assertWorkerOrNode()

export class ShareFacade {
	_crypto: CryptoFacade

	constructor(
		private readonly userFacade: UserFacade,
		crypto: CryptoFacade,
		private readonly serviceExecutor: IServiceExecutor
	) {
		this.userFacade = userFacade
		this._crypto = crypto
	}

	async sendGroupInvitation(
		sharedGroupInfo: GroupInfo,
		sharedGroupName: string,
		recipientMailAddresses: Array<string>,
		shareCapability: ShareCapability,
	): Promise<GroupInvitationPostReturn> {
		const sharedGroupKey = this.userFacade.getGroupKey(sharedGroupInfo.group)

		const userGroupInfoSessionKey = await this._crypto.resolveSessionKeyForInstance(this.userFacade.getUserGroupInfo())
		const sharedGroupInfoSessionKey = await this._crypto.resolveSessionKeyForInstance(sharedGroupInfo)
		const bucketKey = aes128RandomKey()
		const invitationSessionKey = aes128RandomKey()
		const sharedGroupData = createSharedGroupData({
			sessionEncInviterName: encryptString(invitationSessionKey, this.userFacade.getUserGroupInfo().name),
			sessionEncSharedGroupKey: encryptBytes(invitationSessionKey, bitArrayToUint8Array(sharedGroupKey)),
			sessionEncSharedGroupName: encryptString(invitationSessionKey, sharedGroupName),
			bucketEncInvitationSessionKey: encryptKey(bucketKey, invitationSessionKey),
			sharedGroupEncInviterGroupInfoKey: encryptKey(sharedGroupKey, neverNull(userGroupInfoSessionKey)),
			sharedGroupEncSharedGroupInfoKey: encryptKey(sharedGroupKey, neverNull(sharedGroupInfoSessionKey)),
			capability: shareCapability,
			sharedGroup: sharedGroupInfo.group,
		})
		const invitationData = createGroupInvitationPostData({
			sharedGroupData,
			internalKeyData: [],
		})
		const notFoundRecipients: Array<string> = []

		for (let mailAddress of recipientMailAddresses) {
			const keyData = await this._crypto.encryptBucketKeyForInternalRecipient(bucketKey, mailAddress, notFoundRecipients)

			if (keyData) {
				invitationData.internalKeyData.push(keyData)
			}
		}

		if (notFoundRecipients.length > 0) {
			throw new RecipientsNotFoundError(notFoundRecipients.join("\n"))
		}
		return this.serviceExecutor.post(GroupInvitationService, invitationData)
	}

	async acceptGroupInvitation(invitation: ReceivedGroupInvitation): Promise<void> {
		const userGroupInfoSessionKey = await this._crypto.resolveSessionKeyForInstance(this.userFacade.getUserGroupInfo())
		const sharedGroupKey = uint8ArrayToBitArray(invitation.sharedGroupKey)
		const serviceData = createGroupInvitationPutData({
			receivedInvitation: invitation._id,
			userGroupEncGroupKey: encryptKey(this.userFacade.getUserGroupKey(), sharedGroupKey),
			sharedGroupEncInviteeGroupInfoKey: encryptKey(sharedGroupKey, neverNull(userGroupInfoSessionKey))
		})
		await this.serviceExecutor.put(GroupInvitationService, serviceData)
	}

	async rejectGroupInvitation(receivedGroupInvitaitonId: IdTuple): Promise<void> {
		const serviceData = createGroupInvitationDeleteData({
			receivedInvitation: receivedGroupInvitaitonId,
		})
		await this.serviceExecutor.delete(GroupInvitationService, serviceData)
	}
}