// Master Data detail — its OWN route (/master-data/[id]), but it reuses the
// shared lead-detail UI so business/display logic stays identical everywhere
// ("same UI layout is fine, same route is not"). The shared component reads the
// ?back query param, so the Back button returns to the Master Data filtered
// list the user came from. Data source (the Master Data list) stays separate.
export { default } from "../../leads/[id]/page";
