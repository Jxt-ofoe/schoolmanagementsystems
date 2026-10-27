-- Data for table: fee_structures
INSERT INTO "fee_structures" ("id", "school_id", "academic_year_id", "semester_id", "class_id", "category_id", "name", "amount", "due_date", "created_at", "updated_at") VALUES
  ('c99449df-69a4-4052-b83e-7ee99417e1d8', 'a7303214-df0f-4b3c-90c6-0be34d623a09', '65fe49e3-87ea-4f3f-bf3d-93da4c74353f', '349f6a63-955a-4dc2-a2ed-27cbf570238e', NULL, 'df075123-adb0-4c34-8616-1ea1a448c59f', 'Term 1 Fees', 200, NULL, '2026-10-26T20:21:19.066258+00:00', '2026-10-26T20:21:19.066258+00:00'),
  ('8cb784ef-6414-4fcb-b7ec-acb849e0eeea', 'a7303214-df0f-4b3c-90c6-0be34d623a09', '65fe49e3-87ea-4f3f-bf3d-93da4c74353f', '349f6a63-955a-4dc2-a2ed-27cbf570238e', NULL, 'df075123-adb0-4c34-8616-1ea1a448c59f', 'Term 1', 1200, NULL, '2026-10-26T20:22:04.134928+00:00', '2026-10-26T20:22:04.134928+00:00')
ON CONFLICT DO NOTHING;

