import dotenv from "dotenv";
import os from "node:os";
import { exitCode } from "node:process";
import WebSocket from "ws";
import { execFile } from "node:child_process";

dotenv.config();

const serverUrl = process.env.SERVER_URL;

const pcId = process.env.PC_ID;

if (!serverUrl) {
  throw new Error("SERVER_URL is not configured");
}

if (!pcId) {
  throw new Error("PC_ID is not configured");
}

const validatedServerUrl: string = serverUrl;

let socket: WebSocket;

function connect() {
  socket = new WebSocket(validatedServerUrl);

  socket.on("open", () => {
    console.log("Connected to RemoteDesk Server");

    socket.send(
      JSON.stringify({
        type: "agent-register",

        pcId: pcId,

        computerName: os.hostname(),

        platform: os.platform(),

        architecture: os.arch(),
      }),
    );
  });

  function executeScript(
    scriptType: string,
    script: string,
  ): Promise<{
    output: string;
    error: string;
    exitCode: number;
  }> {
    return new Promise((resolve) => {
      let executable: string;
      let args: string[];

      switch (scriptType.toLowerCase()) {
        case "powershell":
          executable = "powershell.exe";

          args = ["-NoProfile", "-NonInteractive", "-Command", script];

          break;

        case "cmd":
          executable = "cmd.exe";

          args = ["/d", "/s", "/c", script];

          break;

        default:
          resolve({
            output: "",
            error: `Unsupported script type: ${scriptType}`,
            exitCode: 1,
          });

          return;
      }

      execFile(
        executable,
        args,
        {
          timeout: 60000,
        },
        (error, stdout, stderr) => {
          resolve({
            output: stdout.trim(),
            error: stderr.trim() || (error ? error.message : ""),
            exitCode: error ? 1 : 0,
          });
        },
      );
    });
  }

  socket.on("message", async (data) => {
    console.log("Message from server:", data.toString());

    const message = JSON.parse(data.toString());

    if (message.type === "job" && message.scriptType && message.script) {
      console.log("PowerShell job received:", message.jobId);

      const result = await executeScript(message.scriptType, message.script);

      socket.send(
        JSON.stringify({
          type: "job-result",
          jobId: message.jobId,
          pcId: pcId,
          status: result.exitCode === 0 ? "success" : "failed",
          output: result.output,
          error: result.error,
          exitCode: result.exitCode,
        }),
      );

      console.log("PowerShell job result sent:", message.jobId);

      return;
    }
  });

  socket.on("close", () => {
    console.log("Disconnected from RemoteDesk Server");
    console.log("Reconnecting in 5 seconds...");
    setTimeout(() => {
      connect();
    }, 5000);
  });

  socket.on("error", (error) => {
    console.error("WebSocket connection error:", error.message);
  });
}
connect();
