import * as core from "@actions/core";
import { runPost } from "./post";
import { notifyCiEnd } from "./oidc";

// Mock the dependencies
jest.mock("@actions/core");
jest.mock("./oidc");

const mockCore = core as jest.Mocked<typeof core>;
const mockNotifyCiEnd = notifyCiEnd as jest.MockedFunction<typeof notifyCiEnd>;

describe("runPost", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should notify CI end when URL and access token are available", async () => {
    // Arrange
    mockCore.getState.mockImplementation((name: string) => {
      if (name === "flyfrog-url") return "https://flyfrog.example.com";
      if (name === "flyfrog-access-token") return "test-access-token";
      return "";
    });
    mockNotifyCiEnd.mockResolvedValue();

    // Act
    await runPost();

    // Assert
    expect(mockCore.getState).toHaveBeenCalledWith("flyfrog-url");
    expect(mockCore.getState).toHaveBeenCalledWith("flyfrog-access-token");
    expect(mockNotifyCiEnd).toHaveBeenCalledWith(
      "https://flyfrog.example.com",
      "test-access-token",
    );
    expect(mockCore.info).toHaveBeenCalledWith(
      "🏁 Notifying FlyFrog that CI job has ended...",
    );
    expect(mockCore.info).toHaveBeenCalledWith(
      "✅ CI end notification completed successfully",
    );
  });

  it("should skip notification when no URL is available", async () => {
    // Arrange
    mockCore.getState.mockImplementation((name: string) => {
      if (name === "flyfrog-url") return "";
      if (name === "flyfrog-access-token") return "test-access-token";
      return "";
    });

    // Act
    await runPost();

    // Assert
    expect(mockCore.getState).toHaveBeenCalledWith("flyfrog-url");
    expect(mockCore.debug).toHaveBeenCalledWith(
      "No FlyFrog URL found in state, skipping CI end notification",
    );
    expect(mockNotifyCiEnd).not.toHaveBeenCalled();
  });

  it("should skip notification when no access token is available", async () => {
    // Arrange
    mockCore.getState.mockImplementation((name: string) => {
      if (name === "flyfrog-url") return "https://flyfrog.example.com";
      if (name === "flyfrog-access-token") return "";
      return "";
    });

    // Act
    await runPost();

    // Assert
    expect(mockCore.getState).toHaveBeenCalledWith("flyfrog-url");
    expect(mockCore.getState).toHaveBeenCalledWith("flyfrog-access-token");
    expect(mockCore.debug).toHaveBeenCalledWith(
      "No access token found in state, skipping CI end notification",
    );
    expect(mockNotifyCiEnd).not.toHaveBeenCalled();
  });

  it("should throw error when CI end notification fails", async () => {
    // Arrange
    mockCore.getState.mockImplementation((name: string) => {
      if (name === "flyfrog-url") return "https://flyfrog.example.com";
      if (name === "flyfrog-access-token") return "test-access-token";
      return "";
    });
    const notificationError = new Error("Notification failed");
    mockNotifyCiEnd.mockRejectedValue(notificationError);

    // Act & Assert
    await expect(runPost()).rejects.toThrow("Notification failed");
    expect(mockNotifyCiEnd).toHaveBeenCalledWith(
      "https://flyfrog.example.com",
      "test-access-token",
    );
  });

  it("should throw error for non-Error notification failures", async () => {
    // Arrange
    mockCore.getState.mockImplementation((name: string) => {
      if (name === "flyfrog-url") return "https://flyfrog.example.com";
      if (name === "flyfrog-access-token") return "test-access-token";
      return "";
    });
    mockNotifyCiEnd.mockRejectedValue("string error");

    // Act & Assert
    await expect(runPost()).rejects.toBe("string error");
  });
});
