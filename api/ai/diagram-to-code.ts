/**
 * Vercel Serverless Function — Yatri AI Diagram-to-Code Proxy
 *
 * Proxies base64 image and text content to the Excalidraw AI backend
 * to bypass CORS issues on the client browser.
 */

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json();

    const response = await fetch("https://oss-ai.excalidraw.com/v1/ai/diagram-to-code/generate-streaming", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      },
      body: JSON.stringify(body),
    });

    const status = response.status;
    const contentType = response.headers.get("content-type") || "text/event-stream";

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(errorText, {
        status,
        headers: {
          "Content-Type": contentType,
          ...cors(),
        },
      });
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        ...cors(),
      },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || "Internal Server Error" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...cors(),
        },
      }
    );
  }
}

export async function OPTIONS(req: Request): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: cors(),
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
