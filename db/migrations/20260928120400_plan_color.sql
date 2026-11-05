-- Atlas OS — let a Plan carry its own context colour, like project/sub_project. See
-- 20260923100000_context_color_and_tags.sql and ADR 0002 §5.
alter table public.objects drop constraint objects_color_type_check;
alter table public.objects add constraint objects_color_type_check
  check (color is null or type in ('project', 'sub_project', 'plan'));
