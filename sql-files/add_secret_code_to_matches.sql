-- Add secret_code column to matches table (without unique constraint first)
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS secret_code TEXT DEFAULT '';

-- Update existing rows to have unique secret codes
UPDATE public.matches 
SET secret_code = upper(substring(md5(random()::text) from 1 for 32))
WHERE secret_code = '' OR secret_code IS NULL;

-- Now add the unique constraint
ALTER TABLE public.matches ALTER COLUMN secret_code SET NOT NULL;
ALTER TABLE public.matches ADD CONSTRAINT matches_secret_code_key UNIQUE (secret_code);

-- Create index for secret_code
CREATE INDEX IF NOT EXISTS matches_secret_code_idx ON public.matches(secret_code);
