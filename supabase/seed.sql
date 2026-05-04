-- WEIN NINA Inventary — datos demo
-- Corre este archivo después de schema.sql.
-- IMPORTANTE: para crear el admin, primero registra el usuario brandonmilan1998@gmail.com
-- en Authentication > Users (Add user > Create new user) con la clave NINA123*
-- y luego ejecuta este SQL para promoverlo a admin.

-- Promover admin (asume que ya existe el auth.user con ese correo)
update public.profiles
   set role = 'admin', name = 'Brandon Villa', avatar = 'BV', goal = 0
 where email = 'brandonmilan1998@gmail.com';

-- Premios de ejemplo
insert into public.prizes (threshold, name, icon) values
  (1000000, 'Bono COP $50.000', '🎁'),
  (2000000, 'Día libre + bono', '🌟'),
  (3000000, 'Outfit completo NINA', '👗'),
  (5000000, 'Bono COP $300.000', '💎')
on conflict do nothing;

-- Productos de ejemplo
insert into public.products (name, sku, category, color, price, cost, sizes) values
  ('Vestido Sirena Plata',     'NIN-VS-001', 'Vestidos',  'Plateado', 189000, 78000, '{"XS":3,"S":5,"M":6,"L":4,"XL":2}'),
  ('Blusa Satín Noir',         'NIN-BL-002', 'Blusas',    'Negro',     89000, 32000, '{"XS":4,"S":8,"M":10,"L":6,"XL":3}'),
  ('Falda Midi Plisada',       'NIN-FA-003', 'Faldas',    'Blanco',   119000, 45000, '{"XS":2,"S":4,"M":5,"L":3,"XL":1}'),
  ('Jean Cintura Alta',        'NIN-JE-004', 'Jeans',     'Negro',    149000, 60000, '{"XS":3,"S":6,"M":8,"L":5,"XL":2}'),
  ('Top Cropped Brillo',       'NIN-TO-005', 'Tops',      'Plateado',  79000, 28000, '{"XS":5,"S":7,"M":9,"L":4,"XL":2}'),
  ('Conjunto Two-Piece',       'NIN-CO-006', 'Conjuntos', 'Blanco',   219000, 95000, '{"XS":2,"S":3,"M":4,"L":3,"XL":1}'),
  ('Blazer Estructurado',      'NIN-BZ-007', 'Blazers',   'Negro',    249000,110000, '{"XS":1,"S":3,"M":4,"L":3,"XL":1}'),
  ('Vestido Mini Lentejuelas', 'NIN-VS-008', 'Vestidos',  'Plateado', 229000, 98000, '{"XS":2,"S":4,"M":5,"L":3,"XL":1}')
on conflict (sku) do nothing;
