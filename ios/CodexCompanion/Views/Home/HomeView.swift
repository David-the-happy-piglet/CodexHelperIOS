import CodexCompanionShared
import SwiftUI

struct HomeView: View {
    @ObservedObject var model: CompanionAppModel
    @State private var showingCreateProject = false

    private var projects: [ProjectGroup] {
        Dictionary(grouping: model.threads, by: \.projectPath)
            .map { projectPath, threads in
                let sorted = threads.sorted { $0.updatedAt > $1.updatedAt }
                let projectName = sorted.first?.projectName ?? URL(fileURLWithPath: projectPath).lastPathComponent
                return ProjectGroup(
                    path: projectPath,
                    name: projectName,
                    threads: sorted,
                    updatedAt: sorted.first?.updatedAt ?? .distantPast,
                    pendingApprovals: sorted.reduce(0) { $0 + $1.pendingApprovals }
                )
            }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    var body: some View {
        ZStack {
            CompanionBackdrop().ignoresSafeArea()

            List {
                if projects.isEmpty {
                    EmptyStateCard(
                        title: "No projects yet",
                        detail: "Create a project from iPhone or pair with a Desktop Helper to sync existing Codex folders.",
                        systemImage: "folder.badge.plus"
                    )
                    .listRowInsets(.init(top: 18, leading: 16, bottom: 18, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                } else {
                    ForEach(projects) { project in
                        NavigationLink {
                            ProjectThreadsView(model: model, project: project)
                        } label: {
                            ProjectRow(project: project)
                        }
                        .buttonStyle(.plain)
                        .listRowInsets(.init(top: 6, leading: 16, bottom: 6, trailing: 16))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarBackground(Color(uiColor: .systemBackground), for: .navigationBar)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    showingCreateProject = true
                } label: {
                    Image(systemName: "plus")
                }

                Button {
                    Task { try? await model.refreshEverything(connectRealtime: true) }
                } label: {
                    if model.isRefreshing {
                        ProgressView()
                    } else {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
        }
        .sheet(isPresented: $showingCreateProject) {
            CreateProjectSheet(model: model)
        }
    }
}

#Preview("Home") {
    NavigationStack {
        HomeView(model: .previewModel())
    }
}

struct ProjectThreadsView: View {
    @ObservedObject var model: CompanionAppModel
    let project: ProjectGroup
    @State private var showingCreateThread = false

    private var threads: [ThreadSummary] {
        model.threads
            .filter { $0.projectPath == project.path }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    var body: some View {
        ZStack {
            CompanionBackdrop().ignoresSafeArea()

            List {
                if threads.isEmpty {
                    EmptyStateCard(
                        title: "No threads yet",
                        detail: "Create the first thread for this project, then continue the Codex conversation from iPhone.",
                        systemImage: "text.bubble"
                    )
                    .listRowInsets(.init(top: 18, leading: 16, bottom: 18, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                } else {
                    ForEach(threads) { thread in
                        NavigationLink {
                            ThreadDetailView(model: model, threadID: thread.id)
                        } label: {
                            ThreadRow(thread: thread)
                        }
                        .buttonStyle(.plain)
                        .listRowInsets(.init(top: 6, leading: 16, bottom: 6, trailing: 16))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
        .navigationTitle(project.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarBackground(Color(uiColor: .systemBackground), for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingCreateThread = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showingCreateThread) {
            CreateThreadSheet(model: model, project: project)
        }
    }
}

struct ProjectGroup: Identifiable, Hashable {
    var id: String { path }

    let path: String
    let name: String
    let threads: [ThreadSummary]
    let updatedAt: Date
    let pendingApprovals: Int
}

private struct ProjectRow: View {
    let project: ProjectGroup

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(project.name)
                    .font(.headline)
                    .lineLimit(1)
                Spacer(minLength: 12)
                Text(project.updatedAt, style: .relative)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 12) {
                Label("\(project.threads.count)", systemImage: "text.bubble")
                if project.pendingApprovals > 0 {
                    Label("\(project.pendingApprovals)", systemImage: "hand.raised")
                }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)

            Text(project.path)
                .font(.caption2.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.vertical, 8)
    }
}

private struct ThreadRow: View {
    let thread: ThreadSummary

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(thread.title)
                    .font(.headline)
                    .lineLimit(2)
                Text(thread.branchOrWorktree)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 10)
            VStack(alignment: .trailing, spacing: 6) {
                StatusChip(status: thread.status)
                Text(thread.updatedAt, style: .relative)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 8)
    }
}

private struct CreateProjectSheet: View {
    @ObservedObject var model: CompanionAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var threadTitle = ""
    @State private var initialPrompt = ""
    @State private var isSubmitting = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Project") {
                    TextField("Folder / project name", text: $name)
                    TextField("First thread title", text: $threadTitle)
                }

                Section("Optional first prompt") {
                    TextField("Tell Codex what to do first", text: $initialPrompt, axis: .vertical)
                        .lineLimit(2...5)
                }
            }
            .scrollContentBackground(.hidden)
            .background(CompanionBackdrop().ignoresSafeArea())
            .navigationTitle("New Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarBackground(Color(uiColor: .systemBackground), for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task {
                            isSubmitting = true
                            defer { isSubmitting = false }
                            let defaultTitle = threadTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                ? "Kick off \(name.trimmingCharacters(in: .whitespacesAndNewlines))"
                                : threadTitle
                            if await model.createProject(
                                name: name,
                                initialThreadTitle: defaultTitle,
                                initialPrompt: initialPrompt
                            ) != nil {
                                dismiss()
                            }
                        }
                    }
                    .disabled(isSubmitting || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}

private struct CreateThreadSheet: View {
    @ObservedObject var model: CompanionAppModel
    let project: ProjectGroup
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var initialPrompt = ""
    @State private var isSubmitting = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Thread") {
                    TextField("Thread title", text: $title)
                    Text(project.path)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }

                Section("Optional first prompt") {
                    TextField("Tell Codex what to do first", text: $initialPrompt, axis: .vertical)
                        .lineLimit(2...5)
                }
            }
            .scrollContentBackground(.hidden)
            .background(CompanionBackdrop().ignoresSafeArea())
            .navigationTitle("New Thread")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarBackground(Color(uiColor: .systemBackground), for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task {
                            isSubmitting = true
                            defer { isSubmitting = false }
                            if await model.createThread(
                                projectPath: project.path,
                                title: title,
                                initialPrompt: initialPrompt
                            ) != nil {
                                dismiss()
                            }
                        }
                    }
                    .disabled(isSubmitting || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
