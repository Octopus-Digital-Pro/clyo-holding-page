import { z } from "zod";

const UMBRACO_BASE_URL = "https://beta.clyo.com";
const FORM_ID = "49ee912c-4928-4b5d-bd5a-3a7768579a17";

export const prerender = false;

const MAX_BODY_BYTES = 10_000;
const MAX_MESSAGE_LENGTH = 250;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

type RateLimitEntry = {
  windowStart: number;
  count: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();

const legacyPayloadSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Please enter your full name.")
    .max(200, "Name is too long."),
  emailAddress: z
    .string()
    .trim()
    .min(1, "Please enter your email address.")
    .max(254, "Email address is too long.")
    .email("Please enter a valid email address."),
  privacyConsent: z
    .preprocess(
      (value) => {
        if (typeof value === "string") {
          return value === "true" || value === "on";
        }
        return value;
      },
      z.literal(true, { message: "You must accept the privacy policy." }),
    )
    .transform(() => true),
  marketingOptIn: z
    .preprocess((value) => {
      if (typeof value === "string") {
        return value === "true" || value === "on";
      }
      return value;
    }, z.boolean().optional())
    .transform((value) => Boolean(value)),
  domainAddress: z.string().trim().max(255).optional(),
  // Optional fields to allow gradual rollout without breaking existing submissions.
  phoneNumber: z
    .string()
    .trim()
    .max(30, "Phone number is too long.")
    .regex(/^[+\d()[\]\s-]+$/, {
      message: "Please enter a valid phone number.",
    })
    .optional(),
  message: z
    .string()
    .trim()
    .max(MAX_MESSAGE_LENGTH, "Message is too long.")
    .optional(),
  recaptchaToken: z.string().trim().min(1).optional(),
});

const newPayloadSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "Please enter your first name.")
    .max(100, "First name is too long."),
  lastName: z
    .string()
    .trim()
    .min(1, "Please enter your last name.")
    .max(100, "Last name is too long."),
  emailAddress: z
    .string()
    .trim()
    .min(1, "Please enter your email address.")
    .max(254, "Email address is too long.")
    .email("Please enter a valid email address."),
  phoneNumber: z
    .string()
    .trim()
    .min(5, "Please enter your phone number.")
    .max(30, "Phone number is too long.")
    .regex(/^[+\d()[\]\s-]+$/, {
      message: "Please enter a valid phone number.",
    }),
  message: z
    .string()
    .trim()
    .min(1, "Please enter a message.")
    .max(MAX_MESSAGE_LENGTH, "Message is too long."),
  privacyAccepted: z
    .preprocess(
      (value) => {
        if (typeof value === "string") {
          return value === "true" || value === "on";
        }
        return value;
      },
      z.literal(true, { message: "You must accept the privacy policy." }),
    )
    .transform(() => true),
  marketingOptIn: z
    .union([z.boolean(), z.undefined()])
    .transform((value) => Boolean(value)),
  domainAddress: z.string().trim().max(255).optional(),
  recaptchaToken: z
    .string()
    .trim()
    .min(1, "Captcha verification failed. Please try again."),
});

type LegacyPayload = z.infer<typeof legacyPayloadSchema>;
type NewPayload = z.infer<typeof newPayloadSchema>;

type ValidationResult =
  | {
      kind: "legacy";
      data: LegacyPayload;
    }
  | {
      kind: "new";
      data: NewPayload;
    };

function getClientIp(request: Request): string {
  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const [first] = xForwardedFor.split(",");
    if (first) {
      return first.trim();
    }
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  return "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const existing = rateLimitStore.get(ip);

  if (!existing) {
    rateLimitStore.set(ip, { windowStart: now, count: 1 });
    return false;
  }

  if (now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { windowStart: now, count: 1 });
    return false;
  }

  existing.count += 1;
  rateLimitStore.set(ip, existing);

  return existing.count > RATE_LIMIT_MAX_REQUESTS;
}

async function verifyRecaptchaToken(token: string, remoteIp: string) {
  const secret = import.meta.env.RECAPTCHA_SECRET_KEY;

  if (!secret) {
    // If no secret is configured, skip verification to avoid breaking environments.
    return { success: true };
  }

  const params = new URLSearchParams();
  params.set("secret", secret);
  params.set("response", token);
  if (remoteIp && remoteIp !== "unknown") {
    params.set("remoteip", remoteIp);
  }

  const response = await fetch(
    "https://www.google.com/recaptcha/api/siteverify",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    },
  );

  if (!response.ok) {
    return { success: false as const };
  }

  const json = (await response.json()) as
    | {
        success: boolean;
        score?: number;
        action?: string;
      }
    | undefined;

  if (!json?.success) {
    return { success: false as const };
  }

  const score = json.score ?? 1.0;
  if (score < 0.5) {
    return { success: false as const };
  }

  return { success: true as const };
}

function normalizeLegacyPayload(payload: LegacyPayload) {
  const trimmedName = payload.name.trim();

  const [firstName, ...rest] = trimmedName.split(/\s+/);
  const lastName = rest.join(" ").trim();

  const normalized: LegacyPayload = {
    ...payload,
    name: trimmedName,
    emailAddress: payload.emailAddress.trim(),
    domainAddress: payload.domainAddress?.trim(),
    marketingOptIn: Boolean(payload.marketingOptIn),
    phoneNumber: payload.phoneNumber?.trim(),
    message:
      payload.message?.trim().slice(0, MAX_MESSAGE_LENGTH) ?? payload.message,
  };

  return {
    normalized,
    derivedFirstName: firstName,
    derivedLastName: lastName || undefined,
  };
}

function normalizeNewPayload(payload: NewPayload): NewPayload {
  return {
    ...payload,
    firstName: payload.firstName.trim(),
    lastName: payload.lastName.trim(),
    emailAddress: payload.emailAddress.trim(),
    phoneNumber: payload.phoneNumber.trim(),
    message: payload.message.trim().slice(0, MAX_MESSAGE_LENGTH),
    domainAddress: payload.domainAddress?.trim(),
    marketingOptIn: Boolean(payload.marketingOptIn),
    recaptchaToken: payload.recaptchaToken.trim(),
  };
}

function pickValidationSchema(
  candidate: unknown,
): { result: ValidationResult } | { error: Response } {
  if (candidate === null || typeof candidate !== "object") {
    return {
      error: new Response(
        JSON.stringify({
          ok: false,
          error: "VALIDATION_ERROR",
          fields: {
            _root: "Invalid request payload.",
          },
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    };
  }

  const record = candidate as Record<string, unknown>;
  const looksLikeNewShape =
    "firstName" in record ||
    "lastName" in record ||
    "phoneNumber" in record ||
    "privacyAccepted" in record;

  if (looksLikeNewShape) {
    const parsed = newPayloadSchema.safeParse(record);

    if (!parsed.success) {
      const fields: Record<string, string> = {};

      for (const issue of parsed.error.issues) {
        const key = issue.path[0] ?? "_root";
        if (typeof key === "string" && !fields[key]) {
          fields[key] = issue.message;
        }
      }

      return {
        error: new Response(
          JSON.stringify({
            ok: false,
            error: "VALIDATION_ERROR",
            fields,
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      };
    }

    const normalized = normalizeNewPayload(parsed.data);

    return {
      result: {
        kind: "new",
        data: normalized,
      },
    };
  }

  const parsed = legacyPayloadSchema.safeParse(record);

  if (!parsed.success) {
    const fields: Record<string, string> = {};

    for (const issue of parsed.error.issues) {
      const key = issue.path[0] ?? "_root";
      if (typeof key === "string" && !fields[key]) {
        fields[key] = issue.message;
      }
    }

    return {
      error: new Response(
        JSON.stringify({
          ok: false,
          error: "VALIDATION_ERROR",
          fields,
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    };
  }

  const { normalized } = normalizeLegacyPayload(parsed.data);

  return {
    result: {
      kind: "legacy",
      data: normalized,
    },
  };
}

export async function POST({ request }: { request: Request }) {
  try {
    const ip = getClientIp(request);

    if (isRateLimited(ip)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "RATE_LIMITED",
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    const rawBodyText = await request.text();

    if (rawBodyText.length > MAX_BODY_BYTES) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "PAYLOAD_TOO_LARGE",
        }),
        {
          status: 413,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    let parsedJson: unknown;

    try {
      parsedJson = rawBodyText ? JSON.parse(rawBodyText) : {};
    } catch (parseError) {
      console.error("Contact form JSON parse error", parseError);

      return new Response(
        JSON.stringify({
          ok: false,
          error: "VALIDATION_ERROR",
          fields: {
            _root: "Invalid JSON in request body.",
          },
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    const envelope =
      parsedJson && typeof parsedJson === "object" && "values" in parsedJson
        ? (parsedJson as { values: unknown })
        : null;

    const candidate = envelope ? envelope.values : parsedJson;

    const picked = pickValidationSchema(candidate);

    if ("error" in picked) {
      return picked.error;
    }

    const { result } = picked;

    const recaptchaToken =
      result.kind === "new"
        ? result.data.recaptchaToken
        : result.data.recaptchaToken;

    if (recaptchaToken) {
      const verification = await verifyRecaptchaToken(recaptchaToken, ip);

      if (!verification.success) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "RECAPTCHA_FAILED",
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }
    }

    const umbracoPayload =
      envelope && result.kind === "legacy"
        ? {
            ...(parsedJson as Record<string, unknown>),
            values: {
              ...(envelope?.values as Record<string, unknown>),
              ...(result.data as Record<string, unknown>),
            },
          }
        : (result.data as Record<string, unknown>);

    const response = await fetch(
      `${UMBRACO_BASE_URL}/umbraco/forms/delivery/api/v1/entries/${FORM_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(umbracoPayload),
      },
    );

    if (!response.ok) {
      console.error(
        "Contact form upstream error",
        response.status,
        await response.text().catch(() => ""),
      );

      return new Response(
        JSON.stringify({
          ok: false,
          error: "SERVER_ERROR",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Thank you for your message.",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error("Contact form handler failed", error);

    return new Response(
      JSON.stringify({
        ok: false,
        error: "SERVER_ERROR",
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
