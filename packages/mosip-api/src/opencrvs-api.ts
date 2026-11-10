import { env } from "./constants";
import { createClient } from "@opencrvs/toolkit/api";
import { EventDocument, getPendingAction } from "@opencrvs/toolkit/events";
import crypto from "node:crypto";

export class OpenCRVSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenCRVSError";
  }
}

/** Fetches the public key from OpenCRVS to be able to verify JWTs */
export const getPublicKey = async (): Promise<string> => {
  try {
    const response = await fetch(env.OPENCRVS_PUBLIC_KEY_URL);
    return response.text();
  } catch (error) {
    console.error(
      `🔑  Failed to fetch public key from Core. Make sure Core is running, and you are able to connect to ${env.OPENCRVS_PUBLIC_KEY_URL}`,
    );
    if (env.isProd) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return getPublicKey();
  }
};

export const confirmRegistration = (
  {
    eventId,
    actionId,
    nationalId,
    registrationNumber,
  }: {
    eventId: string;
    actionId: string;
    nationalId?: string;
    registrationNumber: string;
  },
  { token }: { token: string },
) => {
  const url = new URL("events", env.OPENCRVS_GATEWAY_URL).toString();
  const client = createClient(url, `Bearer ${token}`);

  return client.event.actions.register.accept.mutate({
    transactionId: `mosip-interop-${crypto.randomUUID()}`,
    eventId,
    actionId,
    registrationNumber,
    declaration: {
      "linkedBirth.tongaPassId": nationalId,
    },
  });
};

/**
 * Sends the TongaPass to country config so it can be included in the MOH
 * notification. The value is only passed through, never stored in OpenCRVS.
 * Sent in the request body (not the URL) so it does not end up in access logs.
 */
export const notifyCountryConfigMosipRegistered = async (
  {
    event,
    registrationNumber,
    tongaPassId,
  }: {
    event: EventDocument;
    registrationNumber: string;
    tongaPassId?: string;
  },
  { token }: { token: string },
) => {
  const url = new URL(
    `/trigger/events/${event.type}/mosip-registered`,
    env.COUNTRY_CONFIG_URL,
  );
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ event, registrationNumber, tongaPassId }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) return;
      if (res.status < 500 || attempt === maxAttempts) {
        throw new OpenCRVSError(
          `Country config mosip-registered failed [${res.status}] for event ${event.id}`,
        );
      }
    } catch (error) {
      if (error instanceof OpenCRVSError || attempt === maxAttempts) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
};

export const findEventActionType = async (
  eventId: string,
  { token }: { token: string },
) => {
  const url = new URL("events", env.OPENCRVS_GATEWAY_URL).toString();
  const client = createClient(url, `Bearer ${token}`);

  const event = (await client.event.get.query(eventId)) as EventDocument;

  let action: ReturnType<typeof getPendingAction>;
  try {
    action = getPendingAction(event.actions);
  } catch {
    return null;
  }

  return {
    actionType: action.type,
    eventType: event.type,
    requestId:
      action.type === "APPROVE_CORRECTION" ? action.requestId : undefined,
  };
};