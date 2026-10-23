-- Outside / temporary drivers (2026-09-12)
--
-- When none of our own drivers are free, dispatch needs to hand the job to a
-- driver from another company for that ONE ride. Those drivers must not land in
-- Admin → Drivers: they are not ours, they have no rating, no settlement, no
-- vehicle record, and next week they may not exist at all.
--
-- So the details live on the booking itself, not in `drivers` / `vehicles`.
-- A booking is assigned to EITHER driver_id (ours) OR external_driver_name.
-- The vehicle columns mirror `vehicles` (make / model / color / license plate)
-- so the customer still sees which car is coming and its registration.
begin;

alter table public.bookings add column if not exists external_driver_name    text;
alter table public.bookings add column if not exists external_driver_phone   text;
alter table public.bookings add column if not exists external_driver_company text;

alter table public.bookings add column if not exists external_vehicle_category_id uuid
  references public.vehicle_categories(id) on delete set null;
alter table public.bookings add column if not exists external_vehicle_make   text;
alter table public.bookings add column if not exists external_vehicle_model  text;
alter table public.bookings add column if not exists external_vehicle_color  text;
alter table public.bookings add column if not exists external_vehicle_plate  text;

comment on column public.bookings.external_driver_name is
  'Outside driver this single ride was handed to. Set instead of driver_id; never creates a drivers row.';
comment on column public.bookings.external_driver_phone is
  'Contact number for the outside driver — used for the WhatsApp job message and the customer''s "call driver" button.';
comment on column public.bookings.external_driver_company is
  'Optional: which firm the outside driver came from, so it can be reconciled later.';
comment on column public.bookings.external_vehicle_category_id is
  'Class of car actually sent. Defaults to what the customer booked, but a partner may turn up in a different class.';
comment on column public.bookings.external_vehicle_plate is
  'Registration of the outside car, shown to the customer on the tracking page.';

-- A job cannot belong to one of our drivers and an outside driver at once.
alter table public.bookings drop constraint if exists bookings_one_driver_only;
alter table public.bookings add constraint bookings_one_driver_only
  check (driver_id is null or external_driver_name is null);

-- Finding "which jobs went outside" for reconciliation.
create index if not exists bookings_external_driver_idx
  on public.bookings (external_driver_name)
  where external_driver_name is not null;

commit;
