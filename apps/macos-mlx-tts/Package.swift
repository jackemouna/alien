// swift-tools-version: 6.2
// Isolated MLX TTS helper package. Keep this out of apps/macos/Package.swift so
// normal macOS app tests do not compile the full MLX audio stack.

import PackageDescription

let package = Package(
    name: "AlienMLXTTS",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .executable(name: "alien-mlx-tts", targets: ["AlienMLXTTSHelper"]),
    ],
    dependencies: [
        .package(url: "https://github.com/Blaizzy/mlx-audio-swift", revision: "fc4fe22dc41c053062e647a4e3db9142193670d2"),
    ],
    targets: [
        .executableTarget(
            name: "AlienMLXTTSHelper",
            dependencies: [
                .product(name: "MLXAudioTTS", package: "mlx-audio-swift"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
    ])
