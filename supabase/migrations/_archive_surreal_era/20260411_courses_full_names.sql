-- Atualiza nomes completos dos cursos
UPDATE courses SET name = 'Direito'                                              WHERE id = 4;
UPDATE courses SET name = 'Teologia EAD'                                         WHERE id = 8;
UPDATE courses SET name = 'Teologia Presencial'                                  WHERE id = 5;
UPDATE courses SET name = 'Educação Cristã Clássica'                             WHERE id = 9;
UPDATE courses SET name = 'Formação Política'                                    WHERE id = 12;
UPDATE courses SET name = 'Gestão Escolar'                                       WHERE id = 15;
UPDATE courses SET name = 'Liderança Cristã'                                     WHERE id = 11;
UPDATE courses SET name = 'Missiologia Urbana'                                   WHERE id = 13;
UPDATE courses SET name = 'Psicopedagogia'                                       WHERE id = 16;
UPDATE courses SET name = 'Psicoteologia'                                        WHERE id = 17;
UPDATE courses SET name = 'Teologia Bíblica e Exegética do Novo Testamento'     WHERE id = 10;
UPDATE courses SET name = 'Teologia Sistemática'                                 WHERE id = 14;

-- Adiciona História do Cristianismo (Pós-Graduação)
INSERT INTO courses (name, type, default_value)
VALUES ('História do Cristianismo', 'Pós-Graduação', 5749)
ON CONFLICT DO NOTHING;
