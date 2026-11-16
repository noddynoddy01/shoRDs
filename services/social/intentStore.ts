import AsyncStorage from "@react-native-async-storage/async-storage";
import { createIntentStore } from "./intent.ts";

/** The one shared store for the sign-up persona choice (device-local, non-authoritative; see intent.ts). */
export const intent = createIntentStore(AsyncStorage);
