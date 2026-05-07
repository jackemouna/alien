import CoreLocation
import Foundation
import AlienKit
import UIKit

typealias AlienCameraSnapResult = (format: String, base64: String, width: Int, height: Int)
typealias AlienCameraClipResult = (format: String, base64: String, durationMs: Int, hasAudio: Bool)

protocol CameraServicing: Sendable {
    func listDevices() async -> [CameraController.CameraDeviceInfo]
    func snap(params: AlienCameraSnapParams) async throws -> AlienCameraSnapResult
    func clip(params: AlienCameraClipParams) async throws -> AlienCameraClipResult
}

protocol ScreenRecordingServicing: Sendable {
    func record(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> String
}

@MainActor
protocol LocationServicing: Sendable {
    func authorizationStatus() -> CLAuthorizationStatus
    func accuracyAuthorization() -> CLAccuracyAuthorization
    func ensureAuthorization(mode: AlienLocationMode) async -> CLAuthorizationStatus
    func currentLocation(
        params: AlienLocationGetParams,
        desiredAccuracy: AlienLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
    func startLocationUpdates(
        desiredAccuracy: AlienLocationAccuracy,
        significantChangesOnly: Bool) -> AsyncStream<CLLocation>
    func stopLocationUpdates()
    func startMonitoringSignificantLocationChanges(onUpdate: @escaping @Sendable (CLLocation) -> Void)
    func stopMonitoringSignificantLocationChanges()
}

@MainActor
protocol DeviceStatusServicing: Sendable {
    func status() async throws -> AlienDeviceStatusPayload
    func info() -> AlienDeviceInfoPayload
}

protocol PhotosServicing: Sendable {
    func latest(params: AlienPhotosLatestParams) async throws -> AlienPhotosLatestPayload
}

protocol ContactsServicing: Sendable {
    func search(params: AlienContactsSearchParams) async throws -> AlienContactsSearchPayload
    func add(params: AlienContactsAddParams) async throws -> AlienContactsAddPayload
}

protocol CalendarServicing: Sendable {
    func events(params: AlienCalendarEventsParams) async throws -> AlienCalendarEventsPayload
    func add(params: AlienCalendarAddParams) async throws -> AlienCalendarAddPayload
}

protocol RemindersServicing: Sendable {
    func list(params: AlienRemindersListParams) async throws -> AlienRemindersListPayload
    func add(params: AlienRemindersAddParams) async throws -> AlienRemindersAddPayload
}

protocol MotionServicing: Sendable {
    func activities(params: AlienMotionActivityParams) async throws -> AlienMotionActivityPayload
    func pedometer(params: AlienPedometerParams) async throws -> AlienPedometerPayload
}

struct WatchMessagingStatus: Equatable {
    var supported: Bool
    var paired: Bool
    var appInstalled: Bool
    var reachable: Bool
    var activationState: String
}

struct WatchQuickReplyEvent: Equatable {
    var replyId: String
    var promptId: String
    var actionId: String
    var actionLabel: String?
    var sessionKey: String?
    var note: String?
    var sentAtMs: Int?
    var transport: String
}

struct WatchExecApprovalResolveEvent: Equatable {
    var replyId: String
    var approvalId: String
    var decision: AlienWatchExecApprovalDecision
    var sentAtMs: Int?
    var transport: String
}

struct WatchExecApprovalSnapshotRequestEvent: Equatable {
    var requestId: String
    var sentAtMs: Int?
    var transport: String
}

struct WatchNotificationSendResult: Equatable {
    var deliveredImmediately: Bool
    var queuedForDelivery: Bool
    var transport: String
}

protocol WatchMessagingServicing: AnyObject, Sendable {
    func status() async -> WatchMessagingStatus
    func setStatusHandler(_ handler: (@Sendable (WatchMessagingStatus) -> Void)?)
    func setReplyHandler(_ handler: (@Sendable (WatchQuickReplyEvent) -> Void)?)
    func setExecApprovalResolveHandler(_ handler: (@Sendable (WatchExecApprovalResolveEvent) -> Void)?)
    func setExecApprovalSnapshotRequestHandler(
        _ handler: (@Sendable (WatchExecApprovalSnapshotRequestEvent) -> Void)?)
    func sendNotification(
        id: String,
        params: AlienWatchNotifyParams) async throws -> WatchNotificationSendResult
    func sendExecApprovalPrompt(
        _ message: AlienWatchExecApprovalPromptMessage) async throws -> WatchNotificationSendResult
    func sendExecApprovalResolved(
        _ message: AlienWatchExecApprovalResolvedMessage) async throws -> WatchNotificationSendResult
    func sendExecApprovalExpired(
        _ message: AlienWatchExecApprovalExpiredMessage) async throws -> WatchNotificationSendResult
    func syncExecApprovalSnapshot(
        _ message: AlienWatchExecApprovalSnapshotMessage) async throws -> WatchNotificationSendResult
}

extension CameraController: CameraServicing {}
extension ScreenRecordService: ScreenRecordingServicing {}
extension LocationService: LocationServicing {}
