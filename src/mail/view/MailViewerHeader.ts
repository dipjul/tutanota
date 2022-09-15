import m, {Children, Component, Vnode} from "mithril"
import {InfoLink, lang} from "../../misc/LanguageViewModel.js"
import {getDisplayText, getSenderHeading, isTutanotaTeamMail} from "../model/MailUtils.js"
import {theme} from "../../gui/theme.js"
import {styles} from "../../gui/styles.js"
import {ExpanderPanel} from "../../gui/base/Expander.js"
import {File as TutanotaFile} from "../../api/entities/tutanota/TypeRefs.js"
import {BannerType, InfoBanner} from "../../gui/base/InfoBanner.js"
import {Icons} from "../../gui/base/icons/Icons.js"
import {EventBanner} from "./EventBanner.js"
import {RecipientButton} from "../../gui/base/RecipientButton.js"
import {createAsyncDropdown, createDropdown, DomRectReadOnlyPolyfilled, DropdownButtonAttrs} from "../../gui/base/Dropdown.js"
import {InboxRuleType, MailAuthenticationStatus, TabIndex} from "../../api/common/TutanotaConstants.js"
import {Icon, progressIcon} from "../../gui/base/Icon.js"
import {formatDateWithWeekday, formatDateWithWeekdayAndYear, formatStorageSize, formatTime} from "../../misc/Formatter.js"
import {isAndroidApp, isDesktop, isIOSApp} from "../../api/common/Env.js"
import {Button, ButtonAttrs, ButtonColor, ButtonType} from "../../gui/base/Button.js"
import {px, size} from "../../gui/size.js"
import {showProgressDialog} from "../../gui/dialogs/ProgressDialog.js"
import Badge from "../../gui/base/Badge.js"
import {ContentBlockingStatus, MailViewerViewModel} from "./MailViewerViewModel.js"
import {createMoreSecondaryButtonAttrs} from "../../gui/base/GuiUtils.js"
import {isNotNull, neverNull, noOp, ofClass} from "@tutao/tutanota-utils"
import {IconButton} from "../../gui/base/IconButton.js"
import {promptAndDeleteMails, showMoveMailsDropdown} from "./MailGuiUtils.js"
import {UserError} from "../../api/main/UserError.js"
import {showUserError} from "../../misc/ErrorHandlerImpl.js"
import {BootIcons} from "../../gui/base/icons/BootIcons.js"
import {client} from "../../misc/ClientDetector.js"

export interface MailAddressAndName {
	name: string
	address: string
}

export type MailAddressDropdownCreator = (args: {
	mailAddress: MailAddressAndName,
	defaultInboxRuleField: InboxRuleType | null,
	createContact?: boolean,
}) => Promise<Array<DropdownButtonAttrs>>

export interface MailViewerHeaderAttrs {
	// Passing the whole viewModel because there are a lot of separate bits we might need.
	// If we want to reuse this view we should probably pass everything on its own.
	viewModel: MailViewerViewModel
	onSetContentBlockingStatus: (status: ContentBlockingStatus) => unknown
	createMailAddressContextButtons: MailAddressDropdownCreator
	onEditDraft: () => unknown
	onUnsubscribe: () => unknown,
	onShowHeaders: () => unknown,
	onReportMail: () => unknown,
}

/** The upper part of the mail viewer, everything but the mail body itself. */
export class MailViewerHeader implements Component<MailViewerHeaderAttrs> {
	private detailsExpanded = false
	private filesExpanded = false

	view({attrs}: Vnode<MailViewerHeaderAttrs>): Children {
		const {viewModel} = attrs
		const dateTime = formatDateWithWeekday(viewModel.mail.receivedDate) + " • " + formatTime(viewModel.mail.receivedDate)
		const dateTimeFull = formatDateWithWeekdayAndYear(viewModel.mail.receivedDate) + " • " + formatTime(viewModel.mail.receivedDate)

		if (styles.isSingleColumnLayout()) {
			return m(".header.mlr-safe-inset.mt", [
				this.renderAddressesAndDate(viewModel, attrs, dateTime, dateTimeFull),
				m(ExpanderPanel, {
					expanded: this.detailsExpanded,
				}, this.renderDetails(attrs, {bubbleMenuWidth: 300})),
				m(".plr-l", this.renderAttachments(viewModel)),
				this.renderConnectionLostBanner(viewModel),
				this.renderEventBanner(viewModel),
				m(".plr-l", this.renderBanners(attrs)),
				// FIXME
				m("", this.renderSubject(viewModel)),
			])
		} else {
			return m(".header.mlr-safe-inset", [
				// Subject and actions
				this.renderSubjectActionsLine(viewModel, attrs),
				// addresses and buttons
				this.renderAddressesAndDate(viewModel, attrs, dateTime, dateTimeFull),
				m(ExpanderPanel, {
					expanded: this.detailsExpanded,
				}, this.renderDetails(attrs, {bubbleMenuWidth: 300})),
				m(".plr-l", this.renderAttachments(viewModel)),
				this.renderConnectionLostBanner(viewModel),
				this.renderEventBanner(viewModel),
				m(".plr-l", this.renderBanners(attrs)),
			])
		}
	}

	private renderAddressesAndDate(viewModel: MailViewerViewModel, attrs: MailViewerHeaderAttrs, dateTime: string, dateTimeFull: string) {
		return m(".flex.plr-l.mt-xs.click", {
			"aria-pressed": String(this.detailsExpanded),
			onclick: () => {
				this.detailsExpanded = !this.detailsExpanded
			}
		}, [
			m(".flex.col", [
				m(".small", getSenderHeading(viewModel.mail, false)),
				m(".flex", this.getRecipientEmailAddress(attrs)),
			]),
			m(".flex-grow"),
			m(".flex.items-end.content-accent-fg.svg-content-accent-fg.white-space-pre.ml-s", {
					// Orca refuses to read ut unless it's not focusable
					tabindex: TabIndex.Default,
					"aria-label": lang.get(viewModel.isConfidential() ? "confidential_action" : "nonConfidential_action") + ", " + dateTime,
				},
				[
					viewModel.isConfidential()
						? m(Icon, {
							icon: Icons.Lock,
							style: {
								fill: theme.content_fg,
							},
						})
						: null,
					m("small.date.content-fg.selectable",
						[
							m("span.noprint", dateTime), // show the short date when viewing
							m("span.noscreen", dateTimeFull), // show the date with year when printing
						]
					),
					m(".flex-grow"),
				],
			)
		])
	}

	private renderSubjectActionsLine(viewModel: MailViewerViewModel, attrs: MailViewerHeaderAttrs) {
		return m(".flex", [
			this.renderSubject(viewModel),
			m("", {
				style: {
					marginRight: "12px",
				}
			}, this.actionButtons(attrs))
		])
	}

	private renderSubject(viewModel: MailViewerViewModel) {
		return m(
			".h5.subject.text-break.selectable.b.flex-grow.pl-l.pr",
			{
				"aria-label": lang.get("subject_label") + ", " + (viewModel.getSubject() || ""),
				style: {marginTop: "12px"},
			},
			viewModel.getSubject() || "",
		)
	}

	private renderBanners(attrs: MailViewerHeaderAttrs): Children {
		const {viewModel} = attrs
		return [
			this.renderPhishingWarning(viewModel) || this.renderHardAuthenticationFailWarning(viewModel) || this.renderSoftAuthenticationFailWarning(viewModel),
			this.renderExternalContentBanner(attrs),
			m("hr.hr.mt-xs"),
		].filter(Boolean)
	}

	private renderConnectionLostBanner(viewModel: MailViewerViewModel): Children {
		// If the mail body failed to load, then we show a message in the main column
		// If the mail body did load but not everything else, we show the message here
		if (viewModel.isConnectionLost()) {
			return m(InfoBanner, {
				message: "mailPartsNotLoaded_msg",
				icon: Icons.Warning,
				buttons: [
					{
						label: "retry_action",
						click: () => viewModel.loadAll()
					}
				]
			})
		} else {
			return null
		}
	}

	private renderEventBanner(viewModel: MailViewerViewModel): Children {
		const event = viewModel.getCalendarEventAttachment()
		return event
			? m(EventBanner, {
				event: event.event,
				method: event.method,
				recipient: event.recipient,
				mail: viewModel.mail,
			})
			: null
	}

	private renderDetails(attrs: MailViewerHeaderAttrs, {bubbleMenuWidth}: {bubbleMenuWidth: number}): Children {
		const {viewModel, createMailAddressContextButtons} = attrs
		const envelopeSender = viewModel.getDifferentEnvelopeSender()
		return m(".plr-l", [
				m(".mt-s", m(".small.b", lang.get("from_label")),
					m(RecipientButton, {
						label: getDisplayText(viewModel.getSender().name, viewModel.getSender().address, false),
						click: createAsyncDropdown({
							lazyButtons: () => createMailAddressContextButtons({
								mailAddress: viewModel.getSender(),
								defaultInboxRuleField: InboxRuleType.FROM_EQUALS
							}), width: bubbleMenuWidth
						}),
					}),
					envelopeSender
						? [
							m(".small.b", lang.get("sender_label")),
							m(RecipientButton, {
								label: getDisplayText("", envelopeSender, false),
								click: createAsyncDropdown({
									lazyButtons: async () => {
										const childElements = [
											{
												info: lang.get("envelopeSenderInfo_msg"),
												center: false,
												bold: false,
											},
											{
												info: envelopeSender,
												center: true,
												bold: true,
											},
										]
										const contextButtons = await createMailAddressContextButtons(
											{
												mailAddress: {
													address: envelopeSender,
													name: "",
												},
												defaultInboxRuleField: InboxRuleType.FROM_EQUALS,
												createContact: false
											},
										)
										return [...childElements, ...contextButtons]
									}, width: bubbleMenuWidth
								}),
							}),
						]
						: null
				),
				m(".mt-s", viewModel.getToRecipients().length
					? [
						m(".small.b", lang.get("to_label")),
						m(".flex.col.mt-between-s", viewModel.getToRecipients().map(recipient =>
								m(".flex", m(RecipientButton, {
									label: getDisplayText(recipient.name, recipient.address, false),
									click: createAsyncDropdown(
										{
											lazyButtons: () => createMailAddressContextButtons({
												mailAddress: recipient,
												defaultInboxRuleField: InboxRuleType.RECIPIENT_TO_EQUALS
											}), width: bubbleMenuWidth
										},
									),
									// To wrap text inside flex container, we need to allow element to shrink and pick own width
									style: {
										flex: "0 1 auto",
									},
								})),
							),
						),
					]
					: null),
				m(".mt-s", viewModel.getCcRecipients().length
					? [
						m(".small.b", lang.get("cc_label")),
						m(
							".flex-start.flex-wrap",
							viewModel.getCcRecipients().map(recipient =>
								m(RecipientButton, {
									label: getDisplayText(recipient.name, recipient.address, false),
									click: createAsyncDropdown(
										{
											lazyButtons: () => createMailAddressContextButtons({
												mailAddress: recipient,
												defaultInboxRuleField: InboxRuleType.RECIPIENT_CC_EQUALS
											}), width: bubbleMenuWidth
										},
									),
									style: {
										flex: "0 1 auto",
									},
								}),
							),
						),
					]
					: null),
				m(".mt-s", viewModel.getBccRecipients().length
					? [
						m(".small.b", lang.get("bcc_label")),
						m(
							".flex-start.flex-wrap",
							viewModel.getBccRecipients().map(recipient =>
								m(RecipientButton, {
									label: getDisplayText(recipient.name, recipient.address, false),
									click: createAsyncDropdown(
										{
											lazyButtons: () => createMailAddressContextButtons({
												mailAddress: recipient,
												defaultInboxRuleField: InboxRuleType.RECIPIENT_BCC_EQUALS
											}), width: bubbleMenuWidth
										},
									),
									style: {
										flex: "0 1 auto",
									},
								}),
							),
						),
					]
					: null),
				m(".mt-s", viewModel.getReplyTos().length
					? [
						m(".small.b", lang.get("replyTo_label")),
						m(
							".flex-start.flex-wrap",
							viewModel.getReplyTos().map(recipient =>
								m(RecipientButton, {
									label: getDisplayText(recipient.name, recipient.address, false),
									click: createAsyncDropdown({
										lazyButtons: () => createMailAddressContextButtons({
											mailAddress: recipient,
											defaultInboxRuleField: null
										}), width: bubbleMenuWidth
									}),
									style: {
										flex: "0 1 auto",
									},
								}),
							),
						),
					]
					: null),
			]
		)
	}

	private renderAttachments(viewModel: MailViewerViewModel): Children {
		// Show a loading symbol if we are loading attachments
		if (viewModel.isLoadingAttachments() && !viewModel.isConnectionLost()) {
			return m(".flex", [m(".flex-v-center.pl-button", progressIcon()), m(".small.flex-v-center.plr.button-height", lang.get("loading_msg"))])
		} else {
			const attachments = viewModel.getNonInlineAttachments()
			const attachmentCount = attachments.length

			// Do nothing if we have no attachments
			if (attachmentCount === 0) {
				return null
			}

			// Get the total size of the attachments
			let totalAttachmentSize = 0
			attachments.forEach(attachment => totalAttachmentSize += Number(attachment.size))

			return [
				m(".flex", [
					attachmentCount === 1
						// If we have exactly one attachment, just show the attachment
						? this.renderAttachmentContainer(viewModel, attachments)

						// Otherwise, we show the number of attachments and its total size along with a show all button
						: [
							m(".flex.center-vertically.click.flex-grow.ml-between-s.mt-xs", {
									onclick: () => this.filesExpanded = !this.filesExpanded
								}, [
									m("", lang.get("attachmentAmount_label", {"{amount}": attachmentCount + ""}) + ` (${formatStorageSize(totalAttachmentSize)})`),
									m(Icon, {
										icon: BootIcons.Expand,
										style: {
											fill: theme.content_fg,
											transform: this.filesExpanded ? "rotate(180deg)" : ""
										},
									})
								]
							),
							// m(ToggleButton, {
							// 	icon: BootIcons.Expand,
							// 	title: "showAll_action",
							// 	selected: this.filesExpanded,
							// 	onSelected: (expanded) => this.filesExpanded = expanded
							// }),
							// m(IconButton, {
							// 	icon: Icons.Download,
							// 	title: "saveAll_action",
							// 	click: () => viewModel.downloadAll(),
							// }),
						],
				]),

				// if we have more than one attachment, list them here in this expander panel
				attachments.length > 1
					? m(ExpanderPanel, {
							expanded: this.filesExpanded,
						},
						m(".flex.flex-wrap", {
							style: {
								"column-gap": px(size.hpad),
							}
						}, [
							this.renderAttachmentContainer(viewModel, attachments),
						])
					) : null,
			]
		}
	}

	private renderAttachmentContainer(viewModel: MailViewerViewModel, attachments: TutanotaFile[]): Children {
		return attachments.map(attachment => this.renderAttachmentButton(viewModel, attachment)) // wrap attachments in a div to ensure buttons after the list don't get placed weirdly
	}

	private renderAttachmentButton(viewModel: MailViewerViewModel, attachment: TutanotaFile): Children {
		if (isAndroidApp() || isDesktop()) {
			return m(Button, {
				label: () => attachment.name,
				icon: () => Icons.Attachment,
				type: ButtonType.Bubble,
				staticRightText: `(${formatStorageSize(Number(attachment.size))})`,
				click: createDropdown({
					width: 200,
					overrideOrigin: (originalOrigin) => {
						// Bubble buttons use border so dropdown is misaligned by default
						return new DomRectReadOnlyPolyfilled(
							originalOrigin.left + size.bubble_border_width,
							originalOrigin.top,
							originalOrigin.width,
							originalOrigin.height
						)
					},
					lazyButtons: () => [
						{
							label: "open_action",
							click: () => viewModel.downloadAndOpenAttachment(attachment, true),
						},
						{
							label: "download_action",
							click: () => viewModel.downloadAndOpenAttachment(attachment, false),
						},
					]
				})
			})
		} else {
			return m(Button, {
				label: () => attachment.name,
				icon: () => Icons.Attachment,
				click: () => viewModel.downloadAndOpenAttachment(attachment, true),
				type: ButtonType.Bubble,
				staticRightText: `(${formatStorageSize(Number(attachment.size))})`
			})
		}
	}

	private renderDownloadAllButton(viewModel: MailViewerViewModel): Children {
		return !isIOSApp() && viewModel.getNonInlineAttachments().length > 1
			? m(Button, {
				label: "saveAll_action",
				type: ButtonType.Secondary,
				click: () => showProgressDialog("pleaseWait_msg", viewModel.downloadAll()),
			})
			: null
	}

	private tutaoBadge(viewModel: MailViewerViewModel): Children {
		return isTutanotaTeamMail(viewModel.mail)
			? m(
				Badge,
				{
					classes: ".mr-s",
				},
				"Tutanota Team",
			)
			: null
	}

	private renderPhishingWarning(viewModel: MailViewerViewModel): Children | null {
		if (viewModel.isMailSuspicious()) {
			return m(InfoBanner, {
				message: "phishingMessageBody_msg",
				icon: Icons.Warning,
				type: BannerType.Warning,
				helpLink: InfoLink.Phishing,
				buttons: [
					{
						label: "markAsNotPhishing_action",
						click: () => viewModel.markAsNotPhishing().then(() => m.redraw()),
					},
				],
			})
		}
	}

	private renderHardAuthenticationFailWarning(viewModel: MailViewerViewModel): Children | null {
		if (!viewModel.isWarningDismissed() && viewModel.mail.authStatus === MailAuthenticationStatus.HARD_FAIL) {
			return m(InfoBanner, {
				message: "mailAuthFailed_msg",
				icon: Icons.Warning,
				helpLink: InfoLink.MailAuth,
				type: BannerType.Warning,
				buttons: [
					{
						label: "close_alt",
						click: () => (viewModel.setWarningDismissed(true)),
					},
				],
			})
		}
	}

	private renderSoftAuthenticationFailWarning(viewModel: MailViewerViewModel): Children | null {
		if (!viewModel.isWarningDismissed() && viewModel.mail.authStatus === MailAuthenticationStatus.SOFT_FAIL) {
			return m(InfoBanner, {
				message: () =>
					viewModel.mail.differentEnvelopeSender
						? lang.get("mailAuthMissingWithTechnicalSender_msg", {
							"{sender}": viewModel.mail.differentEnvelopeSender,
						})
						: lang.get("mailAuthMissing_label"),
				icon: Icons.Warning,
				helpLink: InfoLink.MailAuth,
				buttons: [
					{
						label: "close_alt",
						click: () => (viewModel.setWarningDismissed(true)),
					},
				],
			})
		} else {
			return null
		}
	}

	private renderExternalContentBanner(attrs: MailViewerHeaderAttrs): Children | null {
		// only show banner when there are blocked images and the user hasn't made a decision about how to handle them
		if (attrs.viewModel.getContentBlockingStatus() !== ContentBlockingStatus.Block) {
			return null
		}

		const showButton: ButtonAttrs = {
			label: "showBlockedContent_action",
			click: () => attrs.onSetContentBlockingStatus(ContentBlockingStatus.Show),
		}
		const alwaysOrNeverAllowButtons = attrs.viewModel.canPersistBlockingStatus()
			? [
				attrs.viewModel.isMailAuthenticated()
					? {
						label: "allowExternalContentSender_action" as const,
						click: () => attrs.onSetContentBlockingStatus(ContentBlockingStatus.AlwaysShow),
					}
					: null,
				{
					label: "blockExternalContentSender_action" as const,
					click: () => attrs.onSetContentBlockingStatus(ContentBlockingStatus.AlwaysBlock),
				},
			].filter(isNotNull)
			: []
		// on narrow screens the buttons will end up on 2 lines if there are too many, this looks bad.
		const maybeDropdownButtons =
			styles.isSingleColumnLayout() && alwaysOrNeverAllowButtons.length > 1
				? [createMoreSecondaryButtonAttrs(alwaysOrNeverAllowButtons, 216)]
				: alwaysOrNeverAllowButtons
		return m(InfoBanner, {
			message: "contentBlocked_msg",
			icon: Icons.Picture,
			helpLink: InfoLink.LoadImages,
			buttons: [showButton, ...maybeDropdownButtons],
		})
	}

	private actionButtons(attrs: MailViewerHeaderAttrs): Children {
		const {viewModel} = attrs
		const actions: Children = []

		// actions.push(this.renderAttachments(attrs.viewModel))
		// actions.push(m(".flex-grow"))

		const moveButton = m(IconButton, {
			title: "move_action",
			icon: Icons.Folder,
			click: (e, dom) => showMoveMailsDropdown(
				viewModel.mailModel,
				dom.getBoundingClientRect(),
				[viewModel.mail],
			),
		})

		const separator = m("", {
			style: {
				width: "0",
				// FIXME
				height: "24px",
				border: `0.5px solid ${theme.content_border}`,
			}
		})


		if (viewModel.isDraftMail()) {
			actions.push(
				m(IconButton, {
					title: "edit_action",
					click: () => attrs.onEditDraft(),
					icon: Icons.Edit,
				}),
			)
			actions.push(moveButton)
		} else {
			if (!viewModel.isAnnouncement()) {
				actions.push(
					m(IconButton, {
						title: "reply_action",
						click: () => viewModel.reply(false),
						icon: Icons.Reply,
					}),
				)

				if (viewModel.canReplyAll()) {
					actions.push(
						m(IconButton, {
							title: "replyAll_action",
							click: () => viewModel.reply(true),
							icon: Icons.ReplyAll,
						}),
					)
				}

				if (viewModel.canForwardOrMove()) {
					actions.push(
						m(IconButton, {
							title: "forward_action",
							click: () => viewModel.forward()
												  .catch(ofClass(UserError, showUserError)),
							icon: Icons.Forward,
						}),
					)
					// FIXME
					actions.push(separator)
					actions.push(moveButton)
				} else if (viewModel.canAssignMails()) {
					actions.push(this.createAssignActionButton(attrs))
				}
			}
		}

		actions.push(
			m(IconButton, {
				title: "delete_action",
				click: () => {
					promptAndDeleteMails(viewModel.mailModel, [viewModel.mail], noOp)
				},
				icon: Icons.Trash,
			}),
		)

		if (!viewModel.isDraftMail()) {
			actions.push(
				m(IconButton, {
					title: "more_label",
					icon: Icons.More,
					click: this.prepareMoreActions(attrs),
				}),
			)
		}

		return m(".action-bar.flex-end.items-center.mr-negative-s.ml-between-s.mt-xs", actions)
	}

	private createAssignActionButton({viewModel}: MailViewerHeaderAttrs): Children {
		const makeButtons = async (): Promise<DropdownButtonAttrs[]> => {
			const assignmentGroupInfos = await viewModel.getAssignmentGroupInfos()

			return assignmentGroupInfos.map(userOrMailGroupInfo => {
				return {
					label: () => getDisplayText(userOrMailGroupInfo.name, neverNull(userOrMailGroupInfo.mailAddress), true),
					icon: BootIcons.Contacts,
					click: () => viewModel.assignMail(userOrMailGroupInfo),
				}
			})
		}

		return m(IconButton, {
			title: "forward_action",
			icon: Icons.Forward,
			colors: ButtonColor.Content,
			click: createAsyncDropdown({
				width: 250,
				lazyButtons: makeButtons
			})
		})
	}

	private prepareMoreActions({
								   viewModel,
								   onSetContentBlockingStatus,
								   onUnsubscribe,
								   onShowHeaders,
								   onReportMail,
							   }: MailViewerHeaderAttrs
	) {
		return createDropdown({
			lazyButtons: () => {
				const moreButtons: Array<DropdownButtonAttrs> = []
				if (viewModel.isUnread()) {
					moreButtons.push({
						label: "markRead_action",
						click: () => viewModel.setUnread(false),
						icon: Icons.Eye,
					})
				} else {
					moreButtons.push({
						label: "markUnread_action",
						click: () => viewModel.setUnread(true),
						icon: Icons.NoEye,
					})
				}

				if (!client.isMobileDevice() && viewModel.canExport()) {
					moreButtons.push({
						label: "export_action",
						click: () => showProgressDialog("pleaseWait_msg", viewModel.exportMail()),
						icon: Icons.Export,
					})
				}

				if (!client.isMobileDevice() && typeof window.print === "function" && viewModel.canPrint()) {
					moreButtons.push({
						label: "print_action",
						click: () => window.print(),
						icon: Icons.Print,
					})
				}

				if (viewModel.isListUnsubscribe()) {
					moreButtons.push({
						label: "unsubscribe_action",
						click: () => onUnsubscribe(),
						icon: Icons.Cancel,
					})
				}

				if (viewModel.canShowHeaders()) {
					moreButtons.push({
						label: "showHeaders_action",
						click: () => onShowHeaders(),
						icon: Icons.ListUnordered,
					})
				}

				if (viewModel.canReport()) {
					moreButtons.push({
						label: "reportEmail_action",
						click: () => onReportMail(),
						icon: Icons.Warning,
					})
				}

				if (viewModel.canPersistBlockingStatus() && viewModel.isShowingExternalContent()) {
					moreButtons.push({
						label: "disallowExternalContent_action",
						click: async () => {
							await onSetContentBlockingStatus(ContentBlockingStatus.Block)
						},
						icon: Icons.Picture,
					})
				}

				if (viewModel.canPersistBlockingStatus() && viewModel.isBlockingExternalImages()) {
					moreButtons.push({
						label: "showImages_action",
						click: async () => {
							await onSetContentBlockingStatus(ContentBlockingStatus.Show)
						},
						icon: Icons.Picture,
					})
				}

				return moreButtons
			}, width: 300
		})
	}

	getRecipientEmailAddress({viewModel}: MailViewerHeaderAttrs) {
		const {mail} = viewModel
		const allRecipients = mail.toRecipients.concat(mail.ccRecipients).concat(mail.bccRecipients)

		if (allRecipients.length > 0) {
			return m(".flex.click.small.ml-between-s.border-radius.plr-s.ml-negative-s", {
				// toggled: String(this.detailsExpanded),
				// "aria-pressed": String(this.detailsExpanded),
				// onclick: () => {
				// 	this.detailsExpanded = !this.detailsExpanded
				// }
			}, [
				m("", "to:"),
				m(".text-ellipsis", allRecipients[0].address),
				m(".flex", [
						allRecipients.length > 1 ? `+ ${allRecipients.length - 1}` : null,
						m(Icon, {
							icon: BootIcons.Expand,
							container: "div",
							style: {
								fill: theme.content_fg,
								transform: this.detailsExpanded ? "rotate(180deg)" : ""
							},
						})
					],
				)
			])
		} else {
			return ""
		}
	}

}