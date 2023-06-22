import path from 'path';
import fs from 'fs';
import {fillTemplate, createRelativeFromAbsolutePath, parseIdHash} from '../util.js';

const templateString = fs.readFileSync(path.resolve('.', 'public', 'type_templates', 'blockadelabsskybox.js'), 'utf8');

export default {
  async load(id) {
    id = createRelativeFromAbsolutePath(id);

    const {
      contentId,
      name,
      description,
      components,
    } = parseIdHash(id);

    // console.log('parse id', {
    //   id,
    //   contentId,
    // });

    const code = fillTemplate(templateString, {
      srcUrl: JSON.stringify(id),
      contentId: JSON.stringify(contentId),
      name: JSON.stringify(name),
      description: JSON.stringify(description),
      components: JSON.stringify(components),
    });

    return {
      code,
      map: null,
    };
  },
};