import { describe, expect, it } from "vitest";
import { parseErrorMessage } from "../api";

function res(status: number, body: string, statusText = ""): Response {
  return new Response(body, { status, statusText });
}

describe("parseErrorMessage", () => {
  it("surfaces abort_with_message's error.message", async () => {
    expect(
      await parseErrorMessage(res(422, '{"error": {"code": 422, "message": "Unknown report option bogus"}}'))
    ).toBe("Unknown report option bogus");
  });

  it("turns a bare abort()'s envelope into a status line", async () => {
    expect(await parseErrorMessage(res(422, '{"code":422,"status":"Unprocessable Entity"}'))).toBe(
      "Request rejected by the server (422 Unprocessable Entity)"
    );
  });

  it("falls back to a status line for an HTML error page", async () => {
    expect(await parseErrorMessage(res(502, "<html><body>Bad gateway</body></html>", "Bad Gateway"))).toBe(
      "Server error (502 Bad Gateway)"
    );
  });

  it("returns a plain-text body as-is", async () => {
    expect(await parseErrorMessage(res(500, "boom"))).toBe("boom");
  });
});
