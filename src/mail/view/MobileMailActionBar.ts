import m, {Children, Component, Vnode} from "mithril"
import {MailViewerViewModel} from "./MailViewerViewModel.js"
import {IconButton} from "../../gui/base/IconButton.js"
import {createDropdown, DROPDOWN_MARGIN, DropdownButtonAttrs} from "../../gui/base/Dropdown.js"
import {Icons} from "../../gui/base/icons/Icons.js"
import {UserError} from "../../api/main/UserError.js"
import {showUserError} from "../../misc/ErrorHandlerImpl.js"
import {promptAndDeleteMails} from "./MailGuiUtils.js"
import {noOp, ofClass} from "@tutao/tutanota-utils"

export interface MobileMailActionBarAttrs {
	viewModel: MailViewerViewModel,
}

export class MobileMailActionBar implements Component<MobileMailActionBarAttrs> {
	private dom: HTMLElement | null = null

	view(vnode: Vnode<MobileMailActionBarAttrs>): Children {
		const {viewModel} = vnode.attrs
		// FIXME: this is a placeholder. We need to somehow extract the logic for what can be shown.
		const actions: Children[] = []
		actions.push(m(IconButton, {
			title: "reply_action",
			click: viewModel.canReplyAll()
				? createDropdown({
					lazyButtons: () => {
						const buttons: DropdownButtonAttrs[] = []
						buttons.push({
							label: "replyAll_action",
							icon: Icons.ReplyAll,
							// FIXME
							click: () => viewModel.reply(true)
						})

						buttons.push({
							label: "reply_action",
							icon: Icons.Reply,
							click: () => viewModel.reply(false),
						})
						return buttons
					},
					overrideOrigin: (original) => {
						const domRect = this.dom?.getBoundingClientRect()
						if (domRect) {
							// FIXME
							domRect.y -= 4
							return domRect
						} else {
							return original
						}
					},
					// FIXME questionable?
					width: this.dom?.offsetWidth ? this.dom.offsetWidth - DROPDOWN_MARGIN * 2 : undefined,
				})
				: () => viewModel.reply(false),
			icon: viewModel.canReplyAll() ? Icons.ReplyAll : Icons.Reply,
		}))


		actions.push(
			m(IconButton, {
				title: "forward_action",
				click: () => viewModel.forward()
									  .catch(ofClass(UserError, showUserError)),
				icon: Icons.Forward,
			}),
		)

		actions.push(
			m(IconButton, {
				title: "delete_action",
				click: () => promptAndDeleteMails(viewModel.mailModel, [viewModel.mail], noOp),
				icon: Icons.Trash,
			}),
		)

		actions.push(
			m(IconButton, {
				title: "move_action",
				click: noOp,
				icon: Icons.Folder,
			}),
		)

		actions.push(
			m(IconButton, {
				title: "more_label",
				click: noOp,
				icon: Icons.More,
			}),
		)

		return m(".bottom-nav.bottom-action-bar.flex.items-center.plr-l", {
			oncreate: (vnode) => {
				console.log("action bar created??", vnode.dom)
				this.dom = vnode.dom as HTMLElement
			},
			style: {
				justifyContent: "space-between",
			}
		}, [
			actions,
		])

	}
}