import Foundation

public enum ReconnectPolicy {
    public static func delay(for attempt: Int) -> TimeInterval {
        guard attempt > 0 else { return 0 }
        let cappedAttempt = min(attempt, 6)
        return min(pow(2, Double(cappedAttempt - 1)), 30)
    }
}

