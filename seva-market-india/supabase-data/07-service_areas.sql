-- seva_mirror 07-service_areas: 25 row(s) of service_areas
SET lock_timeout = '10s';
BEGIN;
INSERT INTO public.seva_mirror (tbl, id, doc) VALUES
('service_areas','1:781001','{"provider_id":1,"pin_code":"781001","location_id":6}'::jsonb),
('service_areas','1:781006','{"provider_id":1,"pin_code":"781006","location_id":8}'::jsonb),
('service_areas','1:781014','{"provider_id":1,"pin_code":"781014","location_id":10}'::jsonb),
('service_areas','2:781006','{"provider_id":2,"pin_code":"781006","location_id":8}'::jsonb),
('service_areas','2:781028','{"provider_id":2,"pin_code":"781028","location_id":12}'::jsonb),
('service_areas','3:560038','{"provider_id":3,"pin_code":"560038","location_id":46}'::jsonb),
('service_areas','3:560066','{"provider_id":3,"pin_code":"560066","location_id":52}'::jsonb),
('service_areas','4:400050','{"provider_id":4,"pin_code":"400050","location_id":27}'::jsonb),
('service_areas','4:400069','{"provider_id":4,"pin_code":"400069","location_id":25}'::jsonb),
('service_areas','5:411014','{"provider_id":5,"pin_code":"411014","location_id":37}'::jsonb),
('service_areas','5:411038','{"provider_id":5,"pin_code":"411038","location_id":33}'::jsonb),
('service_areas','5:411057','{"provider_id":5,"pin_code":"411057","location_id":35}'::jsonb),
('service_areas','6:600017','{"provider_id":6,"pin_code":"600017","location_id":61}'::jsonb),
('service_areas','6:600020','{"provider_id":6,"pin_code":"600020","location_id":63}'::jsonb),
('service_areas','6:600042','{"provider_id":6,"pin_code":"600042","location_id":65}'::jsonb),
('service_areas','7:110001','{"provider_id":7,"pin_code":"110001","location_id":74}'::jsonb),
('service_areas','7:110024','{"provider_id":7,"pin_code":"110024","location_id":76}'::jsonb),
('service_areas','7:110075','{"provider_id":7,"pin_code":"110075","location_id":80}'::jsonb),
('service_areas','8:700016','{"provider_id":8,"pin_code":"700016","location_id":96}'::jsonb),
('service_areas','8:700064','{"provider_id":8,"pin_code":"700064","location_id":98}'::jsonb),
('service_areas','9:302017','{"provider_id":9,"pin_code":"302017","location_id":103}'::jsonb),
('service_areas','9:302021','{"provider_id":9,"pin_code":"302021","location_id":105}'::jsonb),
('service_areas','10:201301','{"provider_id":10,"pin_code":"201301","location_id":91}'::jsonb),
('service_areas','10:226001','{"provider_id":10,"pin_code":"226001","location_id":85}'::jsonb),
('service_areas','10:226010','{"provider_id":10,"pin_code":"226010","location_id":87}'::jsonb)
ON CONFLICT (tbl, id) DO UPDATE SET doc = EXCLUDED.doc, synced_at = now();
COMMIT;
