// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CodexCompanionShared",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "CodexCompanionShared",
            targets: ["CodexCompanionShared"]
        )
    ],
    targets: [
        .target(
            name: "CodexCompanionShared",
            resources: [
                .process("Resources")
            ]
        ),
        .testTarget(
            name: "CodexCompanionSharedTests",
            dependencies: ["CodexCompanionShared"]
        ),
    ]
)

