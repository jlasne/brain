/**
 * What runs on its own.
 *
 * The digest goes out Monday at 06:00 UTC, which is 08:00 in Paris in summer
 * and 07:00 in winter. A week with nothing new sends nothing.
 *
 * Each morning at 05:30 UTC, a workspace with favourite models is set to the
 * cheapest of them (admin:setFavourites gives it the list). With no favourites
 * nothing is read.
 *
 * At 05:40 UTC, upkeep runs the one-time repairs it has not finished yet (see
 * admin:upkeep). Once they are done it reads two flags and stops.
 */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.weekly("weekly digest", { dayOfWeek: "monday", hourUTC: 6, minuteUTC: 0 }, internal.digest.send, {});
crons.daily("cheapest favourite model", { hourUTC: 5, minuteUTC: 30 }, internal.admin.pickCheapest, {});
crons.daily("upkeep", { hourUTC: 5, minuteUTC: 40 }, internal.admin.upkeep, {});


export default crons;
