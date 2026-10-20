import { chatToolsHint, requesterLine, taskToolsHint } from './assignment-brief.service';

describe('requesterLine', () => {
  it('shows name and role', () => {
    expect(requesterLine({ name: 'Lan', role: 'member', title: null })).toBe(
      'Requested by: Lan (member)',
    );
  });

  it('puts the job title between the name and the role', () => {
    expect(requesterLine({ name: 'Lan', role: 'admin', title: 'Trưởng phòng Kinh doanh' })).toBe(
      'Requested by: Lan, Trưởng phòng Kinh doanh (admin)',
    );
  });

  it('treats an empty title as none', () => {
    expect(requesterLine({ name: 'Lan', role: 'owner', title: '' })).toBe(
      'Requested by: Lan (owner)',
    );
  });

  it('says so when nobody asked', () => {
    expect(requesterLine(null)).toBe(
      'Requested by: nobody in particular (automated run, read-only tools)',
    );
  });
});

describe('tool hints', () => {
  it('list list_skills among the read tools of chat and task runs', () => {
    expect(chatToolsHint()).toContain('list_members, list_skills;');
    expect(taskToolsHint()).toContain('list_members, list_skills;');
  });
});
