import type {ImageHandler} from "../model/MailUtils"
import {ALLOWED_IMAGE_FORMATS, Keys, MAX_BASE64_IMAGE_SIZE} from "../../api/common/TutanotaConstants"
import {uint8ArrayToBase64} from "@tutao/tutanota-utils"
import {lang} from "../../misc/LanguageViewModel"
import {Dialog} from "../../gui/base/Dialog"
import {DataFile} from "../../api/common/DataFile"
import {showFileChooser} from "../../file/FileController.js"
import m from "mithril"
import {ButtonType} from "../../gui/base/Button.js"
import {progressIcon} from "../../gui/base/Icon.js"

export function insertInlineImageB64ClickHandler(ev: Event, handler: ImageHandler) {
	showFileChooser(true, ALLOWED_IMAGE_FORMATS).then(files => {
		const tooBig: DataFile[] = []

		for (let file of files) {
			if (file.size > MAX_BASE64_IMAGE_SIZE) {
				tooBig.push(file)
			} else {
				const b64 = uint8ArrayToBase64(file.data)
				const dataUrlString = `data:${file.mimeType};base64,${b64}`
				handler.insertImage(dataUrlString, {
					style: "max-width: 100%",
				})
			}
		}

		if (tooBig.length > 0) {
			Dialog.message(() =>
				lang.get("tooBigInlineImages_msg", {
					"{size}": MAX_BASE64_IMAGE_SIZE / 1024,
				}),
			)
		}
	})
}

export async function showHeaderDialog(headersPromise: Promise<string | null>) {
	let state: {state: "loading"} | {state: "loaded", headers: string | null} = {state: "loading"}

	headersPromise
		.then((headers) => {
			state = {state: "loaded", headers}
			m.redraw()
		})

	let mailHeadersDialog: Dialog
	const closeHeadersAction = () => {
		mailHeadersDialog?.close()
	}

	mailHeadersDialog = Dialog
		.largeDialog({
			right: [
				{
					label: "ok_action",
					click: closeHeadersAction,
					type: ButtonType.Secondary,
				},
			],
			middle: () => lang.get("mailHeaders_title"),
		}, {
			view: () => m(".white-space-pre.pt.pb.selectable",
				state.state === "loading"
					? m(".center", progressIcon())
					: state.headers ?? m(".center", lang.get("noEntries_msg")),
			),
		})
		.addShortcut({
			key: Keys.ESC,
			exec: closeHeadersAction,
			help: "close_alt",
		})
		.setCloseHandler(closeHeadersAction)
		.show()
}