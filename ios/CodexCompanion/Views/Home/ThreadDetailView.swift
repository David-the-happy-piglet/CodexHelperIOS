import CodexCompanionShared
import SwiftUI

struct ThreadDetailView: View {
    private let bottomAnchorID = "conversation-bottom-anchor"

    @ObservedObject var model: CompanionAppModel
    let threadID: String

    @State private var composerText = ""
    @State private var isSendingInput = false

    private var detail: ThreadDetail? {
        model.threadDetails[threadID]
    }

    private var thread: ThreadSummary? {
        detail?.thread ?? model.threads.first(where: { $0.id == threadID })
    }

    private var latestConversationID: String? {
        detail?.conversation.last?.id
    }

    var body: some View {
        ZStack {
            CompanionBackdrop().ignoresSafeArea()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if let thread {
                            ThreadContextStrip(thread: thread)
                        }

                        if let detail {
                            if !detail.approvals.isEmpty {
                                ForEach(detail.approvals) { approval in
                                    ApprovalInlineCard(model: model, approval: approval)
                                }
                            }

                            if detail.conversation.isEmpty {
                                EmptyStateCard(
                                    title: "No conversation yet",
                                    detail: "Resume this thread from the composer below to continue the Codex session from iPhone.",
                                    systemImage: "message"
                                )
                            } else {
                                ForEach(detail.conversation) { message in
                                    ConversationBubble(message: message)
                                }
                            }
                        } else {
                            EmptyStateCard(
                                title: "Loading conversation",
                                detail: "The helper is reading the persisted Codex thread and rebuilding the mobile conversation view.",
                                systemImage: "clock.arrow.trianglehead.counterclockwise.rotate.90"
                            )
                        }

                        Color.clear
                            .frame(height: 1)
                            .id(bottomAnchorID)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 100)
                }
                .onAppear {
                    scrollToBottom(proxy, animated: false)
                }
                .onChange(of: latestConversationID) { _, _ in
                    scrollToBottom(proxy, animated: true)
                }
            }
        }
        .navigationTitle(thread?.title ?? "Conversation")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarBackground(Color(uiColor: .systemBackground), for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if let thread {
                        Button {
                            Task {
                                await model.sendCommand(
                                    threadID: thread.id,
                                    type: .reviewOnDesktop,
                                    note: "Escalate this thread for a deeper desktop review."
                                )
                            }
                        } label: {
                            Label("Review on Desktop", systemImage: "desktopcomputer")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            composerBar
        }
        .task {
            if detail == nil {
                await model.loadDetail(for: threadID)
            }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool) {
        let action = {
            proxy.scrollTo(bottomAnchorID, anchor: .bottom)
        }

        DispatchQueue.main.async {
            if animated {
                withAnimation(.easeOut(duration: 0.2)) {
                    action()
                }
            } else {
                action()
            }
        }
    }

    private var composerBar: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Resume this thread with a new prompt", text: $composerText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...5)

                Button {
                    let prompt = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !prompt.isEmpty else { return }
                    composerText = ""
                    isSendingInput = true
                    Task {
                        await model.sendInput(threadID: threadID, prompt: prompt)
                        isSendingInput = false
                    }
                } label: {
                    Group {
                        if isSendingInput {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.system(size: 24, weight: .semibold))
                        }
                    }
                    .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .disabled(isSendingInput || composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 10)
        }
        .background(Color(uiColor: .systemBackground))
    }
}

#Preview("Thread Detail") {
    NavigationStack {
        ThreadDetailView(model: .previewModel(), threadID: DemoData.detail.thread.id)
    }
}

private struct ThreadContextStrip: View {
    let thread: ThreadSummary

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(thread.projectName)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text(thread.projectPath)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            StatusChip(status: thread.status)
        }
        .padding(.vertical, 4)
    }
}

private struct ApprovalInlineCard: View {
    @ObservedObject var model: CompanionAppModel
    let approval: ApprovalRequest

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(approval.title)
                        .font(.subheadline.weight(.semibold))
                    Text(approval.rationale)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 12)
                Text(approval.riskLevel.rawValue.capitalized)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
            }

            if approval.status == .pending {
                HStack(spacing: 8) {
                    approvalButton("Approve", tint: .green) {
                        await model.resolveApproval(approval, action: .approve, note: nil)
                    }
                    approvalButton("Reject", tint: .red) {
                        await model.resolveApproval(approval, action: .reject, note: nil)
                    }
                    approvalButton("Ask Summary", tint: .blue) {
                        await model.resolveApproval(approval, action: .askSummary, note: nil)
                    }
                }
            } else {
                Text(approval.status.rawValue.capitalized)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func approvalButton(
        _ title: String,
        tint: Color,
        action: @escaping () async -> Void
    ) -> some View {
        Button {
            Task { await action() }
        } label: {
            Text(title)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
        }
        .buttonStyle(.borderedProminent)
        .tint(tint)
    }
}

private struct ConversationBubble: View {
    let message: ConversationMessage

    private var isUser: Bool {
        message.kind == .user
    }

    private var bubbleTint: Color {
        switch message.kind {
        case .user:
            return Color.blue.opacity(0.16)
        case .assistant:
            return Color.white.opacity(0.8)
        case .plan:
            return Color.mint.opacity(0.16)
        case .reasoning:
            return Color.orange.opacity(0.14)
        case .command:
            return Color.gray.opacity(0.14)
        case .fileChange:
            return Color.green.opacity(0.14)
        case .system:
            return Color.yellow.opacity(0.14)
        }
    }

    var body: some View {
        HStack(alignment: .top) {
            if isUser { Spacer(minLength: 36) }

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text(message.title)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 8)
                    Text(message.createdAt, style: .time)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Text(message.body)
                    .font(.body)
                    .foregroundStyle(.primary)

                if !message.supplemental.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(message.supplemental, id: \.self) { line in
                            Text(line)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(bubbleTint, in: RoundedRectangle(cornerRadius: 18, style: .continuous))

            if !isUser { Spacer(minLength: 36) }
        }
    }
}
