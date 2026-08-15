CREATE TABLE public.user_cabinets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  cab_key TEXT NOT NULL,
  name TEXT NOT NULL,
  manufacturer TEXT,
  spec JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, cab_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_cabinets TO authenticated;
GRANT ALL ON public.user_cabinets TO service_role;

ALTER TABLE public.user_cabinets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own cabinets" ON public.user_cabinets FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own cabinets" ON public.user_cabinets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own cabinets" ON public.user_cabinets FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own cabinets" ON public.user_cabinets FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_user_cabinets_updated_at BEFORE UPDATE ON public.user_cabinets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();