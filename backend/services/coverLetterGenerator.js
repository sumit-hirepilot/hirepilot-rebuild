// Templated cover letter generation from profile data. No LLM is configured
// for this app, so this is honest mail-merge style text generation, not a
// fabricated "AI wrote this" claim.

function generateCoverLetterContent({ name, userTitle, skills = [], jobTitle, companyName }) {
  const displayName = name || 'Candidate';
  const title = userTitle || 'professional';

  const skillsPhrase = skills.length
    ? `My background includes hands-on experience with ${skills.join(', ')}.`
    : 'My background is well aligned with the core requirements of this role.';

  return [
    `Dear ${companyName} Hiring Team,`,
    '',
    `I'm excited to apply for the ${jobTitle} position at ${companyName}. As a ${title}, I've built a track record of delivering results in fast-moving environments, and this role's focus caught my attention immediately.`,
    '',
    skillsPhrase,
    '',
    `I'd welcome the chance to talk about how I can contribute to your team. Thank you for your time and consideration.`,
    '',
    'Best regards,',
    displayName,
  ].join('\n');
}

module.exports = { generateCoverLetterContent };
