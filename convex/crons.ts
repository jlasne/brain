/**
 * What runs on its own.
 *
 * The digest goes out Monday at 06:00 UTC, which is 08:00 in Paris in summer
 * and 07:00 in winter. A week with nothing new sends nothing.
 */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.weekly("weekly digest", { dayOfWeek: "monday", hourUTC: 6, minuteUTC: 0 }, internal.digest.send, {});

/* The scouts read every feed once a day, before the morning in Europe. No model call. */
crons.daily("scouts", { hourUTC: 5, minuteUTC: 17 }, internal.scouts.sweepAll, {});

export default crons;
