import Foundation

public enum SpecialAgentLocationMode: String, Codable, Sendable, CaseIterable {
    case off
    case whileUsing
    case always
}
