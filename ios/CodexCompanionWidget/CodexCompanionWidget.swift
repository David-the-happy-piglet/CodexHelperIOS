import ActivityKit
import CodexCompanionShared
import SwiftUI
import WidgetKit

@main
struct CodexCompanionWidgetBundle: WidgetBundle {
    var body: some Widget {
        CodexThreadLiveActivityWidget()
    }
}

struct CodexThreadLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LiveThreadActivityAttributes.self) { context in
            VStack(alignment: .leading, spacing: 12) {
                Text(context.attributes.projectName)
                    .font(.headline)
                Text(context.state.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                HStack {
                    Label(context.state.status, systemImage: "bolt.fill")
                    Spacer()
                    Label(context.state.elapsedText, systemImage: "timer")
                }
                .font(.caption)
                Text(context.state.phase)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding()
            .activityBackgroundTint(Color.white)
            .activitySystemActionForegroundColor(.black)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading) {
                        Text(context.state.status)
                            .font(.caption.bold())
                        Text(context.attributes.projectName)
                            .font(.caption2)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Label(context.state.elapsedText, systemImage: "timer")
                        .font(.caption)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.title)
                        .font(.footnote)
                        .lineLimit(2)
                }
            } compactLeading: {
                Image(systemName: "iphone.gen3.radiowaves.left.and.right")
            } compactTrailing: {
                Text(context.state.elapsedText)
                    .font(.caption2)
            } minimal: {
                Image(systemName: "bolt.circle.fill")
            }
        }
    }
}

