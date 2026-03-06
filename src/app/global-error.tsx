"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          <div style={{ textAlign: "center", maxWidth: "400px" }}>
            <h1
              style={{
                fontSize: "28px",
                fontWeight: 600,
                color: "#1c1917",
                marginBottom: "12px",
              }}
            >
              Something went wrong
            </h1>
            <p style={{ fontSize: "14px", color: "#a8a29e" }}>
              A critical error occurred. Please try refreshing the page.
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: "24px",
                fontSize: "13px",
                color: "#1c1917",
                border: "1px solid #e7e5e4",
                padding: "10px 24px",
                cursor: "pointer",
                background: "white",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
