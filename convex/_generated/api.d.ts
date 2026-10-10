/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as art from "../art.js";
import type * as auth from "../auth.js";
import type * as calendar from "../calendar.js";
import type * as crons from "../crons.js";
import type * as digest from "../digest.js";
import type * as events from "../events.js";
import type * as exporter from "../exporter.js";
import type * as jobs from "../jobs.js";
import type * as lib_calendarData from "../lib/calendarData.js";
import type * as lib_cleanup from "../lib/cleanup.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_ical from "../lib/ical.js";
import type * as lib_jobs from "../lib/jobs.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_order from "../lib/order.js";
import type * as lib_recur from "../lib/recur.js";
import type * as lib_session from "../lib/session.js";
import type * as lib_time from "../lib/time.js";
import type * as lists from "../lists.js";
import type * as maintenance from "../maintenance.js";
import type * as members from "../members.js";
import type * as mine from "../mine.js";
import type * as notes from "../notes.js";
import type * as polls from "../polls.js";
import type * as push from "../push.js";
import type * as pushNode from "../pushNode.js";
import type * as requests from "../requests.js";
import type * as thanks from "../thanks.js";
import type * as today from "../today.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  art: typeof art;
  auth: typeof auth;
  calendar: typeof calendar;
  crons: typeof crons;
  digest: typeof digest;
  events: typeof events;
  exporter: typeof exporter;
  jobs: typeof jobs;
  "lib/calendarData": typeof lib_calendarData;
  "lib/cleanup": typeof lib_cleanup;
  "lib/constants": typeof lib_constants;
  "lib/crypto": typeof lib_crypto;
  "lib/ical": typeof lib_ical;
  "lib/jobs": typeof lib_jobs;
  "lib/notify": typeof lib_notify;
  "lib/order": typeof lib_order;
  "lib/recur": typeof lib_recur;
  "lib/session": typeof lib_session;
  "lib/time": typeof lib_time;
  lists: typeof lists;
  maintenance: typeof maintenance;
  members: typeof members;
  mine: typeof mine;
  notes: typeof notes;
  polls: typeof polls;
  push: typeof push;
  pushNode: typeof pushNode;
  requests: typeof requests;
  thanks: typeof thanks;
  today: typeof today;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
