import Foundation

public enum AlienLocationMode: String, Codable, Sendable, CaseIterable {
    case off
    case whileUsing
    case always
}
