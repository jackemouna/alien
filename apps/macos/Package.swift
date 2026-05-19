// swift-tools-version: 6.2
// Package manifest for the Alien macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "Alien",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "AlienIPC", targets: ["AlienIPC"]),
        .library(name: "AlienDiscovery", targets: ["AlienDiscovery"]),
        .executable(name: "Alien", targets: ["Alien"]),
        .executable(name: "alien-mac", targets: ["AlienMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.3.0"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.4.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.10.1"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.9.0"),
        .package(url: "https://github.com/steipete/Peekaboo.git", exact: "3.2.1"),
        .package(path: "../shared/AlienKit"),
        .package(path: "../swabble"),
    ],
    targets: [
        .target(
            name: "AlienIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "AlienDiscovery",
            dependencies: [
                .product(name: "AlienKit", package: "AlienKit"),
            ],
            path: "Sources/AlienDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "Alien",
            dependencies: [
                "AlienIPC",
                "AlienDiscovery",
                .product(name: "AlienKit", package: "AlienKit"),
                .product(name: "AlienChatUI", package: "AlienKit"),
                .product(name: "AlienProtocol", package: "AlienKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/Alien.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "AlienMacCLI",
            dependencies: [
                "AlienDiscovery",
                .product(name: "AlienKit", package: "AlienKit"),
                .product(name: "AlienProtocol", package: "AlienKit"),
            ],
            path: "Sources/AlienMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "AlienIPCTests",
            dependencies: [
                "AlienIPC",
                "Alien",
                "AlienDiscovery",
                .product(name: "AlienProtocol", package: "AlienKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
