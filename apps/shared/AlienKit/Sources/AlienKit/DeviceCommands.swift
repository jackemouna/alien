import Foundation

public enum AlienDeviceCommand: String, Codable, Sendable {
    case status = "device.status"
    case info = "device.info"
}

public enum AlienBatteryState: String, Codable, Sendable {
    case unknown
    case unplugged
    case charging
    case full
}

public enum AlienThermalState: String, Codable, Sendable {
    case nominal
    case fair
    case serious
    case critical
}

public enum AlienNetworkPathStatus: String, Codable, Sendable {
    case satisfied
    case unsatisfied
    case requiresConnection
}

public enum AlienNetworkInterfaceType: String, Codable, Sendable {
    case wifi
    case cellular
    case wired
    case other
}

public struct AlienBatteryStatusPayload: Codable, Sendable, Equatable {
    public var level: Double?
    public var state: AlienBatteryState
    public var lowPowerModeEnabled: Bool

    public init(level: Double?, state: AlienBatteryState, lowPowerModeEnabled: Bool) {
        self.level = level
        self.state = state
        self.lowPowerModeEnabled = lowPowerModeEnabled
    }
}

public struct AlienThermalStatusPayload: Codable, Sendable, Equatable {
    public var state: AlienThermalState

    public init(state: AlienThermalState) {
        self.state = state
    }
}

public struct AlienStorageStatusPayload: Codable, Sendable, Equatable {
    public var totalBytes: Int64
    public var freeBytes: Int64
    public var usedBytes: Int64

    public init(totalBytes: Int64, freeBytes: Int64, usedBytes: Int64) {
        self.totalBytes = totalBytes
        self.freeBytes = freeBytes
        self.usedBytes = usedBytes
    }
}

public struct AlienNetworkStatusPayload: Codable, Sendable, Equatable {
    public var status: AlienNetworkPathStatus
    public var isExpensive: Bool
    public var isConstrained: Bool
    public var interfaces: [AlienNetworkInterfaceType]

    public init(
        status: AlienNetworkPathStatus,
        isExpensive: Bool,
        isConstrained: Bool,
        interfaces: [AlienNetworkInterfaceType])
    {
        self.status = status
        self.isExpensive = isExpensive
        self.isConstrained = isConstrained
        self.interfaces = interfaces
    }
}

public struct AlienDeviceStatusPayload: Codable, Sendable, Equatable {
    public var battery: AlienBatteryStatusPayload
    public var thermal: AlienThermalStatusPayload
    public var storage: AlienStorageStatusPayload
    public var network: AlienNetworkStatusPayload
    public var uptimeSeconds: Double

    public init(
        battery: AlienBatteryStatusPayload,
        thermal: AlienThermalStatusPayload,
        storage: AlienStorageStatusPayload,
        network: AlienNetworkStatusPayload,
        uptimeSeconds: Double)
    {
        self.battery = battery
        self.thermal = thermal
        self.storage = storage
        self.network = network
        self.uptimeSeconds = uptimeSeconds
    }
}

public struct AlienDeviceInfoPayload: Codable, Sendable, Equatable {
    public var deviceName: String
    public var modelIdentifier: String
    public var systemName: String
    public var systemVersion: String
    public var appVersion: String
    public var appBuild: String
    public var locale: String

    public init(
        deviceName: String,
        modelIdentifier: String,
        systemName: String,
        systemVersion: String,
        appVersion: String,
        appBuild: String,
        locale: String)
    {
        self.deviceName = deviceName
        self.modelIdentifier = modelIdentifier
        self.systemName = systemName
        self.systemVersion = systemVersion
        self.appVersion = appVersion
        self.appBuild = appBuild
        self.locale = locale
    }
}
