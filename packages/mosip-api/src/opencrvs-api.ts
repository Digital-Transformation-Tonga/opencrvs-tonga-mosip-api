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
      "child.nid": nationalId,
    },
  });
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