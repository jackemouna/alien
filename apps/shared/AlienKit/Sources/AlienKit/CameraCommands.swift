import Foundation

public enum AlienCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
}

public enum AlienCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum AlienCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum AlienCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct AlienCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: AlienCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: AlienCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: AlienCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: AlienCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct AlienCameraClipParams: Codable, Sendable, Equatable {
    public var facing: AlienCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: AlienCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: AlienCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: AlienCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
