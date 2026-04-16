const UMBRACO_BASE_URL = "https://beta.clyo.com";
const FORM_ID = "49ee912c-4928-4b5d-bd5a-3a7768579a17";

export const prerender = false;

export async function POST({ request }: { request: Request }) {
  try {
    const body = await request.json();

    const response = await fetch(
      `${UMBRACO_BASE_URL}/umbraco/forms/delivery/api/v1/entries/${FORM_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    const text = await response.text();

    return new Response(text || null, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json",
      },
    });
  } catch (error) {
    console.error("Contact form proxy failed", error);

    return new Response(
      JSON.stringify({
        message: "Contact form proxy failed.",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
}
