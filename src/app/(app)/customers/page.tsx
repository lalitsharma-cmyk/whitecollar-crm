import { redirect } from "next/navigation";

// Customers module removed — leads are the single lifecycle record.
// Bookings and won deals are filtered views inside /leads.
export default function CustomersPage() {
  redirect("/leads?filter=won");
}
