import { api } from "../auth/firebaseSession";
import { createSocialClient } from "./client";

/** The one community client of the app: every call goes through the authenticated api client (token in the Authorization header only). */
export const social = createSocialClient(api);
