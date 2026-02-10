import { Router } from 'express';
import { Octokit } from 'octokit';
import config from '../config.js';

const router = Router();

function getOctokit() {
  if (!config.githubToken) {
    return null;
  }
  return new Octokit({ auth: config.githubToken });
}

router.get('/repos', async (req, res) => {
  try {
    const octokit = getOctokit();
    if (!octokit) {
      return res.status(400).json({ error: 'GitHub token not configured' });
    }

    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 100,
      type: 'all',
    });

    const repos = data.map(repo => ({
      name: repo.name,
      fullName: repo.full_name,
      url: repo.clone_url,
      description: repo.description,
      language: repo.language,
      updatedAt: repo.updated_at,
      private: repo.private,
    }));

    res.json({ repos });
  } catch (err) {
    console.error('Error listing repos:', err);
    res.status(500).json({ error: 'Failed to list repos' });
  }
});

router.get('/repos/search', async (req, res) => {
  try {
    const octokit = getOctokit();
    if (!octokit) {
      return res.status(400).json({ error: 'GitHub token not configured' });
    }

    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }

    const { data } = await octokit.rest.search.repos({
      q: `${q} user:@me`,
      sort: 'updated',
      per_page: 30,
    });

    const repos = data.items.map(repo => ({
      name: repo.name,
      fullName: repo.full_name,
      url: repo.clone_url,
      description: repo.description,
      language: repo.language,
      updatedAt: repo.updated_at,
      private: repo.private,
    }));

    res.json({ repos });
  } catch (err) {
    console.error('Error searching repos:', err);
    res.status(500).json({ error: 'Failed to search repos' });
  }
});

export default router;
