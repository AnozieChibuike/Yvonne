import { google } from 'googleapis';

export class GoogleTasksService {
  /**
   * @param {import('googleapis').Auth.OAuth2Client} auth 
   */
  constructor(auth) {
    this.tasksApi = google.tasks({ version: 'v1', auth });
  }

  /**
   * Fetch user's Google Task lists
   * @returns {Promise<Array<{id: string, title: string, isDefault: boolean}>>}
   */
  async getTaskLists() {
    const response = await this.tasksApi.tasklists.list({ maxResults: 100 });
    const items = response.data.items || [];
    return items.map(list => ({
      id: list.id,
      title: list.title || 'Untitled List',
      isDefault: list.id === '@default'
    }));
  }

  /**
   * Get pending tasks from a list
   * @param {string} tasklistId 
   * @param {boolean} includeCompleted 
   * @returns {Promise<Array<{id: string, title: string, notes?: string, status: string, due?: string}>>}
   */
  async getTasks(tasklistId = '@default', includeCompleted = false) {
    const params = {
      tasklist: tasklistId,
      maxResults: 100,
      showCompleted: includeCompleted,
      showHidden: false
    };

    if (!includeCompleted) {
      params.showCompleted = false;
    }

    const response = await this.tasksApi.tasks.list(params);
    const items = response.data.items || [];

    // Filter out completed tasks if not requested
    const filtered = includeCompleted 
      ? items 
      : items.filter(t => t.status !== 'completed');

    return filtered.map(t => ({
      id: t.id,
      title: t.title || '(No Title)',
      notes: t.notes || '',
      status: t.status,
      due: t.due ? new Date(t.due).toLocaleDateString() : null
    }));
  }

  /**
   * Add a new task
   * @param {string} title 
   * @param {string} [notes] 
   * @param {string} [tasklistId='@default'] 
   * @returns {Promise<{id: string, title: string}>}
   */
  async addTask(title, notes = '', tasklistId = '@default', dueAt = null) {
    const response = await this.tasksApi.tasks.insert({
      tasklist: tasklistId,
      requestBody: {
        title: title.trim(),
        notes: notes ? notes.trim() : undefined,
        due: dueAt ? new Date(dueAt).toISOString() : undefined
      }
    });

    return {
      id: response.data.id,
      title: response.data.title
    };
  }

  /**
   * Mark a task as completed
   * @param {string} taskId 
   * @param {string} [tasklistId='@default'] 
   * @returns {Promise<{id: string, title: string, status: string}>}
   */
  async completeTask(taskId, tasklistId = '@default') {
    // Google Tasks API requires patching status to 'completed'
    const response = await this.tasksApi.tasks.patch({
      tasklist: tasklistId,
      task: taskId,
      requestBody: {
        status: 'completed',
        completed: new Date().toISOString()
      }
    });

    return {
      id: response.data.id,
      title: response.data.title,
      status: response.data.status
    };
  }

  /**
   * Delete a task
   * @param {string} taskId 
   * @param {string} [tasklistId='@default'] 
   * @returns {Promise<boolean>}
   */
  async deleteTask(taskId, tasklistId = '@default') {
    await this.tasksApi.tasks.delete({
      tasklist: tasklistId,
      task: taskId
    });
    return true;
  }
}
