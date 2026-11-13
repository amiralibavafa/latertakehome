import { apiRequest, DEFAULT_API_URL, listProjects } from '../lib/projects.js';

const baseUrl = process.env.PROJECTS_API_URL || DEFAULT_API_URL;
try {
  console.log('1. Health\n', JSON.stringify(await apiRequest('/api/v1/health', { baseUrl }), null, 2));
  const raw = await apiRequest('/api/v1/proj', { baseUrl });
  console.log('\n2. Raw first page (upstream format)\n', JSON.stringify(raw, null, 2));
  const projects = await listProjects({ baseUrl });
  console.log('\n3. All projects, after pagination and normalization');
  console.table(projects.map(project => ({ id: project.id, title: project.title, status: project.status, tasks: project.todos.length })));
  console.log('\n4. Normalized project example\n', JSON.stringify(projects[0] || null, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
