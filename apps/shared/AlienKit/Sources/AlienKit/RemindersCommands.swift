import Foundation

public enum AlienRemindersCommand: String, Codable, Sendable {
    case list = "reminders.list"
    case add = "reminders.add"
}

public enum AlienReminderStatusFilter: String, Codable, Sendable {
    case incomplete
    case completed
    case all
}

public struct AlienRemindersListParams: Codable, Sendable, Equatable {
    public var status: AlienReminderStatusFilter?
    public var limit: Int?

    public init(status: AlienReminderStatusFilter? = nil, limit: Int? = nil) {
        self.status = status
        self.limit = limit
    }
}

public struct AlienRemindersAddParams: Codable, Sendable, Equatable {
    public var title: String
    public var dueISO: String?
    public var notes: String?
    public var listId: String?
    public var listName: String?

    public init(
        title: String,
        dueISO: String? = nil,
        notes: String? = nil,
        listId: String? = nil,
        listName: String? = nil)
    {
        self.title = title
        self.dueISO = dueISO
        self.notes = notes
        self.listId = listId
        self.listName = listName
    }
}

public struct AlienReminderPayload: Codable, Sendable, Equatable {
    public var identifier: String
    public var title: String
    public var dueISO: String?
    public var completed: Bool
    public var listName: String?

    public init(
        identifier: String,
        title: String,
        dueISO: String? = nil,
        completed: Bool,
        listName: String? = nil)
    {
        self.identifier = identifier
        self.title = title
        self.dueISO = dueISO
        self.completed = completed
        self.listName = listName
    }
}

public struct AlienRemindersListPayload: Codable, Sendable, Equatable {
    public var reminders: [AlienReminderPayload]

    public init(reminders: [AlienReminderPayload]) {
        self.reminders = reminders
    }
}

public struct AlienRemindersAddPayload: Codable, Sendable, Equatable {
    public var reminder: AlienReminderPayload

    public init(reminder: AlienReminderPayload) {
        self.reminder = reminder
    }
}
