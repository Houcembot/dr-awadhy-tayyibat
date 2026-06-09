-- Ajoute un workflow d'approbation à la whitelist /videos.
-- DEFAULT 1 pour que les entrées existantes restent visibles (seed initial déjà approuvé).
-- Les nouveaux POST mettront approved=0 explicitement (pending review).

ALTER TABLE video_whitelist ADD COLUMN approved INTEGER NOT NULL DEFAULT 1;

-- Met NorgZWwnFrQ en pending (signalée comme non-channel Dr Dia)
UPDATE video_whitelist SET approved = 0 WHERE external_id = 'NorgZWwnFrQ';
