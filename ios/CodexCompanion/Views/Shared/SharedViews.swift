import CodexCompanionShared
import SwiftUI
import UIKit

struct InvertedSystemColorScheme<Content: View>: View {
    @State private var effectiveColorScheme: ColorScheme = Self.resolveColorScheme()
    @ViewBuilder let content: Content

    var body: some View {
        content
            .preferredColorScheme(effectiveColorScheme)
            .background(
                ScreenTraitObserver {
                    let next = Self.resolveColorScheme()
                    if next != effectiveColorScheme {
                        effectiveColorScheme = next
                    }
                }
                .allowsHitTesting(false)
            )
    }

    private static func resolveColorScheme() -> ColorScheme {
        let style = UIScreen.main.traitCollection.userInterfaceStyle
        return style == .dark ? .light : .dark
    }
}

private struct ScreenTraitObserver: UIViewRepresentable {
    let onChange: () -> Void

    func makeUIView(context: Context) -> TraitObservingView {
        let view = TraitObservingView()
        view.onChange = onChange
        return view
    }

    func updateUIView(_ uiView: TraitObservingView, context: Context) {
        uiView.onChange = onChange
    }
}

private final class TraitObservingView: UIView {
    var onChange: (() -> Void)?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        onChange?()
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        onChange?()
    }
}

struct CompanionBackdrop: View {
    var body: some View {
        Color(uiColor: .systemBackground)
    }
}

struct StatusChip: View {
    let status: ThreadStatus

    var body: some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }

    private var label: String {
        switch status {
        case .running: "Running"
        case .waiting: "Waiting"
        case .blocked: "Blocked"
        case .error: "Error"
        case .done: "Done"
        case .paused: "Paused"
        }
    }

    private var color: Color {
        switch status {
        case .running: .blue
        case .waiting: .orange
        case .blocked: .yellow
        case .error: .red
        case .done: .green
        case .paused: .gray
        }
    }
}

struct MetricCard: View {
    let title: String
    let value: String
    let icon: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.headline.weight(.semibold))
                .foregroundStyle(tint)
            Text(value)
                .font(.title3.bold())
            Text(title)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

struct SectionCard<Content: View>: View {
    let title: String
    let systemImage: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct EmptyStateCard: View {
    let title: String
    let detail: String
    let systemImage: String

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text(title)
                .font(.subheadline.weight(.semibold))
            Text(detail)
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct ConnectionBanner: View {
    let state: ConnectionBannerState
    let detail: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(color)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding()
        .background(color.opacity(0.10), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var title: String {
        switch state {
        case .connected: "Live connection is healthy"
        case .reconnecting: "Reconnecting to the Desktop Helper"
        case .stale: "Showing cached state"
        case .offline: "Offline from the Desktop Helper"
        }
    }

    private var icon: String {
        switch state {
        case .connected: "bolt.horizontal.circle.fill"
        case .reconnecting: "arrow.triangle.2.circlepath.circle.fill"
        case .stale: "clock.badge.exclamationmark.fill"
        case .offline: "wifi.slash"
        }
    }

    private var color: Color {
        switch state {
        case .connected: .green
        case .reconnecting: .blue
        case .stale: .orange
        case .offline: .red
        }
    }
}

extension ThreadStatus {
    var tint: Color {
        switch self {
        case .running: .blue
        case .waiting: .orange
        case .blocked: .yellow
        case .error: .red
        case .done: .green
        case .paused: .gray
        }
    }
}
