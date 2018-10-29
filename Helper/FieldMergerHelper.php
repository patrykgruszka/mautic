<?php

/*
 * @copyright   2018 Mautic Inc. All rights reserved
 * @author      Mautic, Inc.
 *
 * @link        https://www.mautic.com
 *
 * @license     GNU/GPLv3 http://www.gnu.org/licenses/gpl-3.0.html
 */

namespace MauticPlugin\IntegrationsBundle\Helper;

use MauticPlugin\IntegrationsBundle\Integration\Interfaces\ConfigFormSyncInterface;
use MauticPlugin\IntegrationsBundle\Sync\DAO\Mapping\ObjectMappingDAO;

class FieldMergerHelper
{
    /**
     * @var ConfigFormSyncInterface
     */
    private $integrationObject;

    /**
     * @var array
     */
    private $currentFieldMappings;

    /**
     * FieldMergerHelper constructor.
     *
     * @param ConfigFormSyncInterface $integrationObject
     * @param array                   $currentFieldMappings
     */
    public function __construct(ConfigFormSyncInterface $integrationObject, array $currentFieldMappings)
    {
        $this->integrationObject    = $integrationObject;
        $this->currentFieldMappings = $currentFieldMappings;
    }

    /**
     * @param string $object
     * @param array  $updatedFieldMappings
     */
    public function mergeSyncFieldMapping(string $object, array $updatedFieldMappings)
    {
        $requiredFields = $this->integrationObject->getRequiredFieldsForMapping($object);

        $this->removeNonExistentFieldMappings($object, $requiredFields);

        $this->bindUpdatedFieldMappings($object, $updatedFieldMappings);
    }

    /**
     * @return array
     */
    public function getFieldMappings()
    {
        return $this->currentFieldMappings;
    }

    /**
     * @param string $object
     * @param array  $requiredFields
     */
    private function removeNonExistentFieldMappings(string $object, array $requiredFields)
    {
        $optionalFields = $this->integrationObject->getOptionalFieldsForMapping($object);
        $allFields      = array_merge($requiredFields, $optionalFields);

        if (!isset($this->currentFieldMappings[$object])) {
            $this->currentFieldMappings[$object] = [];
        }

        // Remove any fields that no longer exist
        $this->currentFieldMappings[$object] = array_intersect_key($this->currentFieldMappings[$object], $allFields);
    }

    /**
     * @param string $object
     * @param array  $updatedFieldMappings
     */
    private function bindUpdatedFieldMappings(string $object, array $updatedFieldMappings)
    {
        // Merge updated fields into current fields
        foreach ($updatedFieldMappings as $fieldName => $fieldMapping) {
            if (isset($this->currentFieldMappings[$object][$fieldName])) {
                // Merge
                $this->currentFieldMappings[$object][$fieldName] = array_merge($this->currentFieldMappings[$object][$fieldName], $fieldMapping);

                continue;
            }

            if (!isset($fieldMapping['mappedField'])) {
                // Ignore this one because just direction was updated without a mapped field
                unset($this->currentFieldMappings[$object][$fieldName]);

                continue;
            }

            if (!isset($fieldMapping['syncDirection'])) {
                // Set the default sync direction
                $fieldMapping['syncDirection'] = ObjectMappingDAO::SYNC_BIDIRECTIONALLY;
            }

            $this->currentFieldMappings[$object][$fieldName] = $fieldMapping;
        }
    }
}
