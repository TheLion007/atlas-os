import type { Metadata } from "next";
import { ProjectsLens } from "@/components/lenses/ProjectsLens";

export const metadata: Metadata = { title: "Project · Atlas OS" };

export default function ProjectPage() {
  return <ProjectsLens />;
}
